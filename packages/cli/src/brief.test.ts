import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ReviewModel } from "@sift-review/core";
import {
  BRIEF_SYSTEM_PROMPT,
  briefPayload,
  generateBrief,
  parseBriefJson
} from "./brief.js";
import { SYSTEM_PROMPT } from "./ai.js";

const tempRoots: string[] = [];

afterEach(async () => {
  delete process.env.ANTHROPIC_API_KEY;
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function tempRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sift-brief-"));
  tempRoots.push(root);
  return root;
}

function modelFor(repoRoot: string): ReviewModel {
  return {
    meta: {
      siftVersion: "0.3.0",
      repoRoot,
      diffSpec: "WORKTREE",
      generatedAt: "2026-01-01T00:00:00.000Z",
      git: { headSha: "abc123", branch: "main" },
      astCoverage: 1
    },
    files: [],
    hunks: [
      {
        id: "h1",
        file: "src/auth.ts",
        language: "typescript",
        header: "@@",
        lines: [{ kind: "add", text: "const token = rotate();", newLine: 1 }],
        addedLines: 1,
        removedLines: 0,
        category: "logic",
        categoryReason: "DEFAULT_LOGIC",
        risk: 80,
        band: "high",
        reasons: [{ code: "TLS_DISABLED", label: "TLS", weight: 45 }],
        groupId: "high-risk-logic",
        digest: { headline: "Adds `rotate()` (+1 lines)", details: [], source: "auto" }
      },
      {
        id: "h2",
        file: "src/secret.ts",
        language: "typescript",
        header: "@@",
        lines: [{ kind: "add", text: "const key = 'AKIA-super-secret';", newLine: 1 }],
        addedLines: 1,
        removedLines: 0,
        category: "logic",
        categoryReason: "DEFAULT_LOGIC",
        risk: 70,
        band: "high",
        reasons: [{ code: "SECRET_LIKE", label: "secret", weight: 50 }],
        groupId: "high-risk-logic",
        digest: { headline: "Adds a secret-like value", details: [], source: "auto" }
      }
    ],
    groups: [
      {
        id: "high-risk-logic",
        title: "High-risk logic",
        kind: "attention",
        order: 10,
        hunkIds: ["h1", "h2"],
        totalAdded: 2,
        totalRemoved: 0,
        digest: "2 hunks — high-risk logic (2 lines)"
      }
    ],
    totals: { changedLines: 2, attentionLines: 2, reviewableLines: 2, files: 2 }
  };
}

describe("review brief", () => {
  it("parses JSON with and without code fences", () => {
    expect(parseBriefJson('{"story":"Adds token rotation.","readingHint":"Start in auth.ts"}')).toEqual({
      story: "Adds token rotation.",
      readingHint: "Start in auth.ts"
    });
    expect(parseBriefJson('```json\n{"story":"Adds rotation."}\n```')).toEqual({
      story: "Adds rotation.",
      readingHint: null
    });
  });

  it("excludes secret-like hunk patches from the payload", () => {
    const payload = briefPayload(modelFor("/repo"));
    expect(payload).toContain("Adds `rotate()`");
    expect(payload).toContain("[omitted: contains secret-like content]");
    expect(payload).not.toContain("AKIA-super-secret");
  });

  it("generates and caches a brief, then reuses the cache", async () => {
    const repoRoot = await tempRoot();
    process.env.ANTHROPIC_API_KEY = "test-key";
    const model = modelFor(repoRoot);
    let calls = 0;
    const call = () => {
      calls += 1;
      return Promise.resolve(
        '{"story":"Rotates refresh tokens across the auth module.","readingHint":"Start in auth.ts"}'
      );
    };

    const first = await generateBrief(model, "anthropic", { call });
    expect(first?.story).toContain("Rotates refresh tokens");
    expect(first?.provider).toBe("anthropic");
    expect(calls).toBe(1);
    await expect(fs.stat(path.join(repoRoot, ".sift", "ai-cache"))).resolves.toBeTruthy();

    const second = await generateBrief(model, "anthropic", {
      call: () => Promise.reject(new Error("should not be called on a cache hit"))
    });
    expect(second?.story).toBe(first?.story);
    expect(calls).toBe(1);
  });

  it("bypasses the cache when useCache is false", async () => {
    const repoRoot = await tempRoot();
    process.env.ANTHROPIC_API_KEY = "test-key";
    const model = modelFor(repoRoot);
    let calls = 0;
    const call = () => {
      calls += 1;
      return Promise.resolve(`{"story":"Version ${calls}.","readingHint":null}`);
    };

    await generateBrief(model, "anthropic", { call });
    const bypassed = await generateBrief(model, "anthropic", { call, useCache: false });
    expect(calls).toBe(2);
    expect(bypassed?.story).toBe("Version 2.");
  });

  it("prompt contracts never invite a verdict", () => {
    const forbidden = [/\bsafe to approve\b/iu, /\blooks good\b/iu, /\blgtm\b/iu];
    for (const prompt of [BRIEF_SYSTEM_PROMPT, SYSTEM_PROMPT]) {
      for (const pattern of forbidden) {
        expect(pattern.test(prompt)).toBe(false);
      }
      expect(prompt.toLowerCase()).toContain("never");
    }
  });
});
