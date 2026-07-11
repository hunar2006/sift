import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadFlagReasons } from "./config.js";
import { DEFAULT_FLAG_REASONS } from "./flag-reasons.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function repo(config?: unknown): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sift-config-"));
  roots.push(root);
  if (config !== undefined) {
    await fs.mkdir(path.join(root, ".sift"), { recursive: true });
    await fs.writeFile(path.join(root, ".sift", "config.json"), JSON.stringify(config), "utf8");
  }
  return root;
}

describe("loadFlagReasons", () => {
  it("returns defaults when no config exists", async () => {
    expect(await loadFlagReasons(await repo())).toEqual([...DEFAULT_FLAG_REASONS]);
  });

  it("reads and caps custom reasons", async () => {
    const root = await repo({ flagReasons: ["A", "B", "C", "D", "E", "F", "G"] });
    expect(await loadFlagReasons(root)).toEqual(["A", "B", "C", "D", "E", "F"]);
  });

  it("falls back to defaults on invalid config", async () => {
    const root = await repo({ flagReasons: "not-an-array" });
    expect(await loadFlagReasons(root)).toEqual([...DEFAULT_FLAG_REASONS]);
  });
});
