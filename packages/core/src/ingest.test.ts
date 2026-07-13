import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  GH_AUTH_MESSAGE,
  ghInstallMessage,
  ingestPrDiff,
  listPullRequests,
  normalizePrReference,
  type GhRunner
} from "./ingest.js";

const execFileAsync = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function repoRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sift-pr-"));
  roots.push(root);
  await execFileAsync("git", ["init"], { cwd: root, windowsHide: true });
  return root;
}

function successfulGh(calls: string[][]): GhRunner {
  return (args) => {
    calls.push(args);
    if (args[0] === "pr" && args[1] === "list") {
      return Promise.resolve({ stdout: '[{"number":123,"title":"Tighten onboarding","author":{"login":"hunar"}}]' });
    }
    if (args[0] === "pr" && args[1] === "diff") {
      return Promise.resolve({ stdout: "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-a\n+b\n" });
    }
    return Promise.resolve({ stdout: "ok\n" });
  };
}

describe("GitHub pull request ingest", () => {
  it.each([
    ["123", "123"],
    ["https://github.com/acme/sift/pull/123", "acme/sift#123"],
    ["acme/sift#123", "acme/sift#123"]
  ])("normalizes %s", (input, expected) => {
    expect(normalizePrReference(input)).toBe(expected);
  });

  it("uses normalized PR arguments after mocked gh checks", async () => {
    const root = await repoRoot();
    const calls: string[][] = [];
    const ingested = await ingestPrDiff(root, "https://github.com/acme/sift/pull/123", successfulGh(calls));
    expect(ingested.diffSpec).toBe("pr/acme/sift#123");
    expect(calls).toEqual([
      ["--version"],
      ["auth", "status"],
      ["pr", "diff", "123", "--patch", "--repo", "acme/sift"]
    ]);
  });

  it("separates missing CLI and sign-in errors", async () => {
    const root = await repoRoot();
    await expect(ingestPrDiff(root, "123", () => Promise.reject(new Error("missing")))).rejects.toThrow(ghInstallMessage());
    await expect(
      ingestPrDiff(root, "123", (args) =>
        args[0] === "--version" ? Promise.resolve({ stdout: "gh version" }) : Promise.reject(new Error("unauthenticated"))
      )
    ).rejects.toThrow(GH_AUTH_MESSAGE);
  });

  it("lists pull requests after mocked gh checks", async () => {
    const calls: string[][] = [];
    await expect(listPullRequests("repo", successfulGh(calls))).resolves.toEqual([
      { number: 123, title: "Tighten onboarding", author: "hunar" }
    ]);
    expect(calls.at(-1)).toEqual(["pr", "list", "--limit", "10", "--json", "number,title,author"]);
  });
});
