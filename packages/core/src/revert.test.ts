import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  FileChangedSinceRevertError,
  RevertUnavailableError,
  readReverts,
  revertScopeFor,
  snapshotAndRevert,
  undoRevert
} from "./revert.js";

const execFileAsync = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function repo(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sift-revert-"));
  roots.push(root);
  await git(root, ["init"]);
  await git(root, ["config", "user.email", "sift@example.test"]);
  await git(root, ["config", "user.name", "Sift test"]);
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.writeFile(path.join(root, "src", "sample.ts"), "export const before = 1;\n", "utf8");
  await git(root, ["add", "."]);
  await git(root, ["commit", "-m", "baseline"]);
  return root;
}

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd, windowsHide: true });
}

describe("snapshot-first file revert", () => {
  it("BUG-01-revert-worktree-undo-restores-byte-exact-CRLF-BOM-and-no-final-newline", async () => {
    const root = await repo();
    const file = path.join(root, "src", "sample.ts");
    const original = Buffer.from([0xef, 0xbb, 0xbf, ...Buffer.from("export const ü = 'x';\r\n// no final newline", "utf8")]);
    await fs.writeFile(file, original);

    const reverted = await snapshotAndRevert({
      repoRoot: root,
      filePath: "src/sample.ts",
      diffSpec: "WORKTREE",
      hunkStates: [{ hunkId: "h1", status: "flagged", note: "Needs tests" }]
    });
    expect((await fs.readFile(file, "utf8")).replace(/\r\n/g, "\n")).toBe("export const before = 1;\n");
    expect((await readReverts(root)).at(-1)?.blobSha).toBe(reverted.blobSha);

    await undoRevert(root, reverted.id);
    expect(await fs.readFile(file)).toEqual(original);
  });

  it("reverts staged content through restore and records hunk state", async () => {
    const root = await repo();
    const file = path.join(root, "src", "sample.ts");
    await fs.writeFile(file, "export const staged = true;\n", "utf8");
    await git(root, ["add", "src/sample.ts"]);

    const record = await snapshotAndRevert({
      repoRoot: root,
      filePath: "src/sample.ts",
      diffSpec: "STAGED",
      hunkStates: [{ hunkId: "h1", status: "approved" }]
    });
    expect((await fs.readFile(file, "utf8")).replace(/\r\n/g, "\n")).toBe("export const before = 1;\n");
    expect(record.hunkStates).toEqual([{ hunkId: "h1", status: "approved" }]);
  });

  it("reverts an untracked new file and can put it back", async () => {
    const root = await repo();
    const file = path.join(root, "src", "new.ts");
    const original = Buffer.from("export const newFile = '✓';\n", "utf8");
    await fs.writeFile(file, original);

    const record = await snapshotAndRevert({ repoRoot: root, filePath: "src/new.ts", diffSpec: "WORKTREE" });
    await expect(fs.stat(file)).rejects.toMatchObject({ code: "ENOENT" });
    await undoRevert(root, record.id);
    expect(await fs.readFile(file)).toEqual(original);
  });

  it("aborts before modifying a missing snapshot source", async () => {
    const root = await repo();
    const file = path.join(root, "src", "sample.ts");
    const before = await fs.readFile(file);
    await expect(snapshotAndRevert({ repoRoot: root, filePath: "src/missing.ts", diffSpec: "WORKTREE" })).rejects.toThrow();
    expect(await fs.readFile(file)).toEqual(before);
  });

  it("refuses a conflicted file before snapshot or restore", async () => {
    const root = await repo();
    const file = path.join(root, "src", "sample.ts");
    await git(root, ["checkout", "-b", "conflict-source"]);
    await fs.writeFile(file, "export const branch = 'source';\n", "utf8");
    await git(root, ["add", "src/sample.ts"]);
    await git(root, ["commit", "-m", "source change"]);
    await git(root, ["checkout", "-"]);
    await fs.writeFile(file, "export const branch = 'current';\n", "utf8");
    await git(root, ["add", "src/sample.ts"]);
    await git(root, ["commit", "-m", "current change"]);
    await execFileAsync("git", ["merge", "conflict-source"], { cwd: root, windowsHide: true }).catch(() => undefined);

    await expect(snapshotAndRevert({ repoRoot: root, filePath: "src/sample.ts", diffSpec: "WORKTREE" })).rejects.toBeInstanceOf(
      RevertUnavailableError
    );
    expect(await fs.readFile(file, "utf8")).toContain("<<<<<<<");
  });

  it("refuses historical specs and byte-mismatched targeted undo", async () => {
    const root = await repo();
    expect(revertScopeFor("HEAD~1..HEAD")).toBeNull();
    await expect(snapshotAndRevert({ repoRoot: root, filePath: "src/sample.ts", diffSpec: "HEAD~1..HEAD" })).rejects.toBeInstanceOf(
      RevertUnavailableError
    );

    const file = path.join(root, "src", "sample.ts");
    await fs.writeFile(file, "export const changed = 2;\n", "utf8");
    const record = await snapshotAndRevert({ repoRoot: root, filePath: "src/sample.ts", diffSpec: "WORKTREE" });
    await fs.writeFile(file, "human changed this after revert\n", "utf8");
    await expect(undoRevert(root, record.id)).rejects.toBeInstanceOf(FileChangedSinceRevertError);
  });
});
