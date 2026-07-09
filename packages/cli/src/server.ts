import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { promises as fs } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BulkApproveBlockedError,
  approveGroup,
  computeStats,
  mergeReviewState,
  readGitFile,
  readHistory,
  readReviewState,
  readWorktreeFile,
  renderStats,
  statusUpdateSchema,
  updateHunkStatus,
  type ReviewModel
} from "@sift-review/core";

export interface ServerContext {
  model: ReviewModel;
  provenanceRecords: number;
  aiRan: boolean;
  refresh(): Promise<{ model: ReviewModel; provenanceRecords: number; aiRan: boolean }>;
}

export function createSiftApp(context: ServerContext): Hono {
  const app = new Hono();
  const refreshFn = () => context.refresh();
  let current = context;

  app.use("/api/*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    await next();
  });

  app.get("/api/review", async (c) => {
    const { state } = await readReviewState(current.model.meta.repoRoot);
    return c.json(mergeReviewState(current.model, state));
  });

  app.get("/api/file", async (c) => {
    const filePath = c.req.query("path");
    const side = c.req.query("side") ?? "new";
    if (!filePath) {
      return c.json({ error: "Missing path." }, 400);
    }
    const text =
      side === "old"
        ? await readGitFile(current.model.meta.repoRoot, "HEAD", filePath)
        : await readWorktreeFile(current.model.meta.repoRoot, filePath);
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
    const state = await updateHunkStatus(
      current.model.meta.repoRoot,
      c.req.param("id"),
      parsed.data.status,
      parsed.data.note
    );
    return c.json(state);
  });

  app.post("/api/groups/:id/approve", async (c) => {
    try {
      const result = await approveGroup(current.model.meta.repoRoot, current.model, c.req.param("id"));
      return c.json({ approved: result.length });
    } catch (error) {
      if (error instanceof BulkApproveBlockedError) {
        return c.json({ error: error.message, hunkIds: error.hunkIds }, 409);
      }
      throw error;
    }
  });

  app.post("/api/refresh", async (c) => {
    current = { ...(await refreshFn()), refresh: refreshFn };
    const { state } = await readReviewState(current.model.meta.repoRoot);
    return c.json(mergeReviewState(current.model, state));
  });

  app.get("/api/stats", async (c) => {
    const { state } = await readReviewState(current.model.meta.repoRoot);
    return c.json(computeStats(current.model, state));
  });

  app.get("/api/meta", (c) =>
    c.json({
      version: current.model.meta.siftVersion,
      repoRoot: current.model.meta.repoRoot,
      diffSpec: current.model.meta.diffSpec,
      counts: current.model.totals,
      provenanceSourcesFound: current.provenanceRecords > 0,
      aiRan: current.aiRan
    })
  );

  const webDist = resolveWebDist();
  app.use("/*", serveStatic({ root: webDist }));
  app.get("*", async (c) => c.html(await fs.readFile(path.join(webDist, "index.html"), "utf8")));
  return app;
}

export async function startServer(context: ServerContext, preferredPort: number): Promise<{ url: string; close(): Promise<void> }> {
  const port = await firstFreePort(preferredPort);
  const app = createSiftApp(context);
  const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port });
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      })
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
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "web", "dist");
}
