import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { initQuickstart, runInit } from "./init.js";

const execFileAsync = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await fs.rm(root, { recursive: true, force: true });
  }
});

async function gitRepo(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sift-init-"));
  roots.push(root);
  await execFileAsync("git", ["init"], { cwd: root, windowsHide: true });
  return root;
}

describe("sift init", () => {
  it("writes starters once and is idempotent", async () => {
    const root = await gitRepo();
    const first = await runInit(root);
    expect(first.some((line) => line.startsWith("wrote"))).toBe(true);
    const config = await fs.readFile(path.join(root, ".sift", "config.json"), "utf8");
    expect(config).toContain("_comment");
    const rules = await fs.readFile(path.join(root, ".sift", "rules.yml"), "utf8");
    expect(rules).toContain("BAN_LEGACY_AUTH");
    const second = await runInit(root);
    expect(second.every((line) => line.startsWith("exists"))).toBe(true);
    expect(initQuickstart().split("\n")).toEqual([
      "Sift files are ready.",
      "  sift          # review",
      "  sift tui      # terminal",
      "  sift --watch  # live",
      "  ?             # keys"
    ]);
  });
});
