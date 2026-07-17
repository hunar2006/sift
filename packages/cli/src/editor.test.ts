import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ReviewModel } from "@sift-review/core";
import { commandForSetting, editorLaunchCommand, EditorNotFoundError, openHunkInEditor, resolveEditor } from "./editor.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("editor jump", () => {
  it("uses known editor arguments and safe template substitution", () => {
    expect(commandForSetting("code", "/repo/src/app.ts", 12)).toEqual({
      bin: "code",
      args: ["-g", "/repo/src/app.ts:12"]
    });
    expect(commandForSetting("subl %f:%l", "/repo/src/app.ts", 12)).toEqual({
      bin: "subl",
      args: ["/repo/src/app.ts:12"]
    });
  });

  it("rejects unsafe binaries and incomplete templates", () => {
    expect(() => commandForSetting("code;rm %f %l", "/repo/a.ts", 1)).toThrow("unsafe binary");
    expect(() => commandForSetting("subl %f", "/repo/a.ts", 1)).toThrow("must include %f and %l");
  });

  it("launches supported Windows editor shims through cmd without shelling custom editors", () => {
    expect(editorLaunchCommand({ bin: "code", args: ["-g", "C:\\repo\\src\\app.ts:12"] }, "win32", "cmd.exe")).toEqual({
      bin: "cmd.exe",
      args: ["/d", "/s", "/c", "code", "-g", "C:\\repo\\src\\app.ts:12"]
    });
    expect(editorLaunchCommand({ bin: "subl", args: ["C:\\repo\\src\\app.ts:12"] }, "win32", "cmd.exe")).toEqual({
      bin: "subl",
      args: ["C:\\repo\\src\\app.ts:12"]
    });
  });

  it("prefers configured editor settings and otherwise detects code before cursor", async () => {
    const repoRoot = await tempRoot();
    await fs.mkdir(path.join(repoRoot, ".sift"));
    await fs.writeFile(path.join(repoRoot, ".sift", "config.json"), JSON.stringify({ editor: "cursor" }), "utf8");
    await expect(resolveEditor(repoRoot, "/repo/a.ts", 3, { exists: () => Promise.resolve(false) })).resolves.toMatchObject({ bin: "cursor" });

    await fs.rm(path.join(repoRoot, ".sift", "config.json"));
    const checked: string[] = [];
    const codeFile = process.platform === "win32" ? "code.exe" : "code";
    const detected = await resolveEditor(repoRoot, "/repo/a.ts", 3, {
      env: { PATH: "/bin" },
      exists: (candidate) => {
        checked.push(candidate);
        return Promise.resolve(candidate.endsWith(path.join("bin", codeFile)));
      }
    });
    expect(detected).toMatchObject({ bin: "code", args: ["-g", "/repo/a.ts:3"] });
    expect(checked.some((candidate) => candidate.endsWith(path.join("bin", codeFile)))).toBe(true);
  });

  it("opens the server-resolved hunk location through execFile-style arguments", async () => {
    const repoRoot = await tempRoot();
    await fs.mkdir(path.join(repoRoot, ".sift"));
    await fs.writeFile(path.join(repoRoot, ".sift", "config.json"), JSON.stringify({ editor: "code" }), "utf8");
    const calls: Array<{ bin: string; args: string[] }> = [];
    await openHunkInEditor(repoRoot, modelFor(repoRoot), "h1", {
      platform: "linux",
      execute: (bin, args) => {
        calls.push({ bin, args });
        return Promise.resolve();
      }
    });
    expect(calls).toEqual([{ bin: "code", args: ["-g", `${path.join(repoRoot, "src", "app.ts")}:7`] }]);
  });

  it("reports a clear error when no configured or detected editor exists", async () => {
    const repoRoot = await tempRoot();
    await expect(openHunkInEditor(repoRoot, modelFor(repoRoot), "h1", { exists: () => Promise.resolve(false) })).rejects.toBeInstanceOf(
      EditorNotFoundError
    );
  });
});

async function tempRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sift-editor-"));
  tempRoots.push(root);
  return root;
}

function modelFor(repoRoot: string): ReviewModel {
  return {
    meta: {
      siftVersion: "0.4.0",
      repoRoot,
      diffSpec: "WORKTREE",
      generatedAt: "2026-07-10T00:00:00.000Z",
      git: { headSha: "abc", branch: "main" },
      astCoverage: 1
    },
    files: [],
    hunks: [
      {
        id: "h1",
        file: "src/app.ts",
        language: "typescript",
        header: "@@",
        lines: [{ kind: "add", text: "export const app = 1;", newLine: 7 }],
        addedLines: 1,
        removedLines: 0,
        category: "logic",
        categoryReason: "DEFAULT_LOGIC",
        risk: 20,
        band: "low",
        reasons: [],
        groupId: "logic",
        digest: { headline: "Adds `app`", details: [], source: "auto" }
      }
    ],
    groups: [],
    totals: { changedLines: 1, attentionLines: 1, reviewableLines: 1, files: 1 }
  };
}
