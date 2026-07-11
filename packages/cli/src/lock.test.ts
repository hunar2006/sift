import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { acquireLock, lockPath, readLock, releaseLock } from "./lock.js";

const roots: string[] = [];
const children: Array<ReturnType<typeof spawn>> = [];

afterEach(async () => {
  for (const child of children.splice(0)) {
    child.kill();
  }
  for (const root of roots.splice(0)) {
    await fs.rm(root, { recursive: true, force: true });
  }
});

describe("sift lock.json", () => {
  it("writes and clears the current process lock", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "sift-lock-"));
    roots.push(root);
    const warning = await acquireLock(root, "tui");
    expect(warning).toBeUndefined();
    expect(await readLock(root)).toMatchObject({ pid: process.pid, surface: "tui" });
    await releaseLock(root);
    expect(await readLock(root)).toBeNull();
  });

  it("warns when another live pid holds the lock and tolerates stale locks", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "sift-lock-"));
    roots.push(root);
    await fs.mkdir(path.join(root, ".sift"), { recursive: true });

    await fs.writeFile(
      lockPath(root),
      JSON.stringify({ pid: 2_147_000_000, surface: "web", startedAt: new Date().toISOString() }, null, 2),
      "utf8"
    );
    expect(await acquireLock(root, "tui")).toBeUndefined();
    await releaseLock(root);

    const sleeper = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
      windowsHide: true
    });
    children.push(sleeper);
    await fs.writeFile(
      lockPath(root),
      JSON.stringify({ pid: sleeper.pid, surface: "web", startedAt: new Date().toISOString() }, null, 2),
      "utf8"
    );
    const warning = await acquireLock(root, "tui");
    expect(warning).toBe("state is also open in another sift process — last write wins");
    expect(await readLock(root)).toMatchObject({ pid: process.pid, surface: "tui" });
  });
});
