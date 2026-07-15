import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { existsSync, promises as fs } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BulkApproveBlockedError,
  approveGroup,
  appendJournal,
  buildProvenanceTimeline,
  computeStats,
  createJournalId,
  FileChangedSinceRevertError,
  loadFlagReasons,
  makeJournalEntry,
  readJournal,
  mergeReviewState,
  openHunkSchema,
  readGitFile,
  readHistory,
  readReviewState,
  readWorktreeFile,
  renderMarkdownReport,
  renderStats,
  RevertUnavailableError,
  snapshotAndRevert,
  undoRevert,
  statusUpdateSchema,
  updateHunkStatus,
  withWordDiffSegments,
  type ReviewBrief,
  type ReviewModel
} from "@sift-review/core";
import { EditorNotFoundError, openHunkInEditor } from "./editor.js";

export interface ServerContext {
  model: ReviewModel;
  provenanceRecords: number;
  aiRan: boolean;
  brief: ReviewBrief | null;
  watchActive?: boolean;
  refresh(): Promise<{ model: ReviewModel; provenanceRecords: number; aiRan: boolean; brief: ReviewBrief | null }>;
}

export interface ModelUpdatedEvent {
  addedIds: string[];
  removedIds: string[];
  totals: ReviewModel["totals"];
  generatedAt: string;
}

export class SiftServerState {
  current: ServerContext;
  private readonly listeners = new Set<(event: ModelUpdatedEvent) => void>();

  constructor(context: ServerContext) {
    this.current = context;
  }

  async refresh(): Promise<void> {
    const refresh = this.current.refresh;
    this.current = { ...(await refresh()), refresh, watchActive: this.current.watchActive };
  }

  update(next: Omit<ServerContext, "refresh">, event: ModelUpdatedEvent): void {
    this.current = { ...next, refresh: this.current.refresh, watchActive: this.current.watchActive };
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  subscribe(listener: (event: ModelUpdatedEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export function createSiftApp(context: ServerContext | SiftServerState): Hono {
  const app = new Hono();
  const state = context instanceof SiftServerState ? context : new SiftServerState(context);

  app.use("/api/*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    await next();
  });

  app.get("/api/review", async (c) => {
    const { state: reviewState } = await readReviewState(state.current.model.meta.repoRoot);
    return c.json(withWordDiffSegments(mergeReviewState(state.current.model, reviewState)));
  });

  app.get("/api/events", (c) => {
    const encoder = new TextEncoder();
    let unsubscribe: () => void = () => undefined;
    let heartbeat: NodeJS.Timeout | undefined;
    const dispose = (controller: ReadableStreamDefaultController<Uint8Array>) => {
      unsubscribe();
      if (heartbeat) {
        clearInterval(heartbeat);
        heartbeat = undefined;
      }
      controller.close();
    };
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        unsubscribe = state.subscribe((event) => {
          controller.enqueue(encoder.encode(`event: model-updated\ndata: ${JSON.stringify(event)}\n\n`));
        });
        heartbeat = setInterval(() => controller.enqueue(encoder.encode(": heartbeat\n\n")), 15_000);
        c.req.raw.signal.addEventListener("abort", () => dispose(controller), { once: true });
      },
      cancel() {
        unsubscribe();
        if (heartbeat) {
          clearInterval(heartbeat);
        }
      }
    });
    return c.body(stream, 200, {
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream"
    });
  });

  app.get("/api/file", async (c) => {
    const filePath = c.req.query("path");
    const side = c.req.query("side") ?? "new";
    if (!filePath) {
      return c.json({ error: "Missing path." }, 400);
    }
    const text =
      side === "old"
        ? await readGitFile(state.current.model.meta.repoRoot, "HEAD", filePath)
        : await readWorktreeFile(state.current.model.meta.repoRoot, filePath);
    if (text === null) {
      return c.json({ error: "File is binary, missing, or oversized." }, 404);
    }
    return c.text(text);
  });

  app.post("/api/hunks/:id/status", async (c) => {
    const parsed = statusUpdateSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ error: "Invalid status body." }, 400);
    }
    const hunk = state.current.model.hunks.find((candidate) => candidate.id === c.req.param("id"));
    if (!hunk) {
      return c.json({ error: "Unknown hunk." }, 404);
    }
    const reviewState = await updateHunkStatus(
      state.current.model.meta.repoRoot,
      c.req.param("id"),
      parsed.data.status,
      parsed.data.note,
      { file: hunk.file, via: parsed.data.via ?? "single" }
    );
    return c.json(reviewState);
  });

  app.post("/api/hunks/:id/revert", async (c) => {
    const hunk = state.current.model.hunks.find((candidate) => candidate.id === c.req.param("id"));
    if (!hunk) {
      return c.json({ error: "Unknown hunk." }, 404);
    }
    try {
      const fileHunks = state.current.model.hunks.filter((candidate) => candidate.file === hunk.file);
      const { state: reviewState } = await readReviewState(state.current.model.meta.repoRoot);
      const revert = await snapshotAndRevert({
        repoRoot: state.current.model.meta.repoRoot,
        filePath: hunk.file,
        diffSpec: state.current.model.meta.diffSpec,
        hunkStates: fileHunks.map((candidate) => {
          const stored = reviewState.hunks[candidate.id] ?? { status: "unreviewed" as const };
          return { hunkId: candidate.id, status: stored.status, note: stored.note };
        })
      });
      await appendJournal(
        state.current.model.meta.repoRoot,
        makeJournalEntry({
          id: revert.id,
          hunkId: hunk.id,
          file: hunk.file,
          via: "single",
          kind: "revert",
          action: "Reverted",
          fromStatus: reviewState.hunks[hunk.id]?.status ?? "unreviewed",
          fromNote: reviewState.hunks[hunk.id]?.note,
          toStatus: "unreviewed"
        })
      );
      await state.refresh();
      return c.json({ id: revert.id, path: revert.path, hunkIds: revert.hunkStates.map((item) => item.hunkId) });
    } catch (error) {
      if (error instanceof RevertUnavailableError) {
        return c.json({ error: error.message }, 409);
      }
      throw error;
    }
  });

  app.get("/api/journal", async (c) => {
    const entries = await readJournal(state.current.model.meta.repoRoot);
    return c.json(entries.slice(-50).reverse());
  });

  app.post("/api/journal/:id/undo", async (c) => {
    const entries = await readJournal(state.current.model.meta.repoRoot);
    const target = entries.find((entry) => entry.id === c.req.param("id"));
    if (!target) {
      return c.json({ error: "Decision no longer exists." }, 404);
    }
    if (target.kind === "revert") {
      try {
        const reverted = await undoRevert(state.current.model.meta.repoRoot, target.id);
        for (const hunkState of reverted.hunkStates) {
          await updateHunkStatus(state.current.model.meta.repoRoot, hunkState.hunkId, hunkState.status, hunkState.note, {
            file: reverted.path,
            via: "targeted-undo",
            journal: false
          });
        }
        await appendJournal(
          state.current.model.meta.repoRoot,
          makeJournalEntry({
            hunkId: target.hunkId,
            file: reverted.path,
            via: "targeted-undo",
            kind: "revert",
            action: "Undid revert",
            fromStatus: "unreviewed",
            toStatus: target.fromStatus
          })
        );
        await state.refresh();
        return c.json({ hunkIds: reverted.hunkStates.map((item) => item.hunkId), compound: true, reverted: true });
      } catch (error) {
        if (error instanceof FileChangedSinceRevertError) {
          return c.json({ error: "File changed since." }, 409);
        }
        throw error;
      }
    }
    const changes = target.compoundId
      ? entries.filter((entry) => entry.compoundId === target.compoundId)
      : [target];
    const hunksById = new Map(state.current.model.hunks.map((hunk) => [hunk.id, hunk]));
    const missing = changes.find((entry) => !hunksById.has(entry.hunkId));
    if (missing) {
      return c.json({ error: "A changed hunk is no longer in this review." }, 409);
    }
    const { state: reviewState } = await readReviewState(state.current.model.meta.repoRoot);
    const stale = changes.find((entry) => {
      const current = reviewState.hunks[entry.hunkId] ?? { status: "unreviewed" as const };
      return current.status !== entry.toStatus || current.note !== entry.toNote;
    });
    if (stale) {
      return c.json({ error: "Decision changed since." }, 409);
    }
    const undoCompoundId = target.compoundId ? createJournalId() : undefined;
    for (const entry of changes) {
      const hunk = hunksById.get(entry.hunkId)!;
      await updateHunkStatus(state.current.model.meta.repoRoot, entry.hunkId, entry.fromStatus, entry.fromNote, {
        file: hunk.file,
        via: "targeted-undo",
        kind: "status",
        compoundId: undoCompoundId
      });
    }
    return c.json({ hunkIds: changes.map((entry) => entry.hunkId), compound: Boolean(target.compoundId) });
  });

  app.post("/api/open", async (c) => {
    const parsed = openHunkSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ error: "Invalid open request." }, 400);
    }
    try {
      await openHunkInEditor(state.current.model.meta.repoRoot, state.current.model, parsed.data.hunkId);
      return c.json({ opened: true });
    } catch (error) {
      if (error instanceof EditorNotFoundError) {
        return c.json({ error: error.message }, 404);
      }
      if (error instanceof Error && error.message === "Unknown hunk.") {
        return c.json({ error: error.message }, 404);
      }
      throw error;
    }
  });

  app.post("/api/groups/:id/approve", async (c) => {
    try {
      const result = await approveGroup(state.current.model.meta.repoRoot, state.current.model, c.req.param("id"));
      return c.json({ approved: result.length });
    } catch (error) {
      if (error instanceof BulkApproveBlockedError) {
        return c.json({ error: error.message, hunkIds: error.hunkIds }, 409);
      }
      throw error;
    }
  });

  app.post("/api/refresh", async (c) => {
    await state.refresh();
    const { state: reviewState } = await readReviewState(state.current.model.meta.repoRoot);
    return c.json(withWordDiffSegments(mergeReviewState(state.current.model, reviewState)));
  });

  app.get("/api/stats", async (c) => {
    const { state: reviewState } = await readReviewState(state.current.model.meta.repoRoot);
    return c.json(computeStats(state.current.model, reviewState));
  });

  app.get("/api/timeline", (c) => c.json(buildProvenanceTimeline(state.current.model)));

  app.get("/api/brief", (c) => {
    if (!state.current.brief) {
      return c.json({ error: "No briefing available. Re-run with --ai." }, 404);
    }
    return c.json(state.current.brief);
  });

  app.get("/api/report", async (c) => {
    const { state: reviewState } = await readReviewState(state.current.model.meta.repoRoot);
    const stats = computeStats(state.current.model, reviewState);
    const markdown = renderMarkdownReport(state.current.model, reviewState, stats);
    if ((c.req.query("format") ?? "md") === "md") {
      return c.text(markdown, 200, { "Content-Type": "text/markdown; charset=utf-8" });
    }
    return c.json({ markdown });
  });

  app.get("/api/meta", async (c) =>
    c.json({
      version: state.current.model.meta.siftVersion,
      repoRoot: state.current.model.meta.repoRoot,
      diffSpec: state.current.model.meta.diffSpec,
      astCoverage: state.current.model.meta.astCoverage,
      counts: state.current.model.totals,
      provenanceSourcesFound: state.current.provenanceRecords > 0,
      aiRan: state.current.aiRan,
      watchActive: state.current.watchActive === true,
      briefAvailable: state.current.brief !== null,
      flagReasons: await loadFlagReasons(state.current.model.meta.repoRoot)
    })
  );

  const webDist = resolveWebDist();
  app.use("/*", serveStatic({ root: webDist }));
  app.get("*", async (c) => c.html(await fs.readFile(path.join(webDist, "index.html"), "utf8")));
  return app;
}

export async function startServer(
  context: ServerContext,
  preferredPort: number
): Promise<{ url: string; port: number; close(): Promise<void>; update(next: Omit<ServerContext, "refresh">, event: ModelUpdatedEvent): void }> {
  const port = await firstFreePort(preferredPort);
  const state = new SiftServerState(context);
  const app = createSiftApp(state);
  const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port });
  return {
    port,
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
    update: (next, event) => state.update(next, event)
  };
}

export async function statsText(model: ReviewModel): Promise<string> {
  const { state } = await readReviewState(model.meta.repoRoot);
  const stats = computeStats(model, state);
  const history = await readHistory(model.meta.repoRoot);
  return renderStats(stats, history);
}

async function firstFreePort(start: number): Promise<number> {
  for (let port = start; port < start + 100; port += 1) {
    if (await canListen(port)) {
      return port;
    }
  }
  throw new Error("No free localhost port found starting at 4111.");
}

function canListen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

function resolveWebDist(): string {
  const distDir = path.dirname(fileURLToPath(import.meta.url));
  const packaged = path.join(distDir, "web");
  if (existsSync(path.join(packaged, "index.html"))) {
    return packaged;
  }
  return path.resolve(distDir, "..", "..", "web", "dist");
}
