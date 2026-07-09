import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Hunk } from "@sift-review/core";
import { captureHookInput } from "./capture.js";
import { installHooks, hooksStatus, uninstallHooks } from "./hooks.js";
import { matchProvenance } from "./match.js";
import { loadHookLog, parseTranscript } from "./transcripts.js";

describe("claude adapter", () => {
  it("matches hook provenance and captures hook input fail-open", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sift-adapter-"));
    const env = { ...process.env, SIFT_HOME: path.join(repoRoot, ".sift") };
    await captureHookInput(
      JSON.stringify({
        session_id: "s1",
        transcript_path: "/tmp/s1.jsonl",
        cwd: repoRoot,
        tool_name: "Edit",
        tool_input: { file_path: path.join(repoRoot, "src/a.ts"), new_string: "const a = 1;\n" }
      }),
      env
    );
    await captureHookInput("not json", env);
    const records = await loadHookLog(repoRoot, env);
    const hunk: Hunk = {
      id: "h1",
      file: "src/a.ts",
      language: "typescript",
      header: "@@",
      lines: [{ kind: "add", text: "const a = 1;", newLine: 1 }],
      addedLines: 1,
      removedLines: 0,
      category: "logic",
      categoryReason: "DEFAULT_LOGIC",
      risk: 35,
      band: "low",
      reasons: [],
      groupId: "low-risk-logic"
    };
    expect(matchProvenance([hunk], records).get("h1")?.confidence).toBe(1);
  });

  it("round-trips hooks and parses tolerant transcripts", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sift-hooks-"));
    const claudeHome = path.join(repoRoot, ".claude-home");
    const env = { ...process.env, SIFT_CLAUDE_DIR: claudeHome };
    expect(await hooksStatus(repoRoot, false, env)).toBe(false);
    await installHooks(repoRoot, false, env);
    expect(await hooksStatus(repoRoot, false, env)).toBe(true);
    await uninstallHooks(repoRoot, false, env);
    expect(await hooksStatus(repoRoot, false, env)).toBe(false);

    const transcript = path.join(repoRoot, "session.jsonl");
    await fs.writeFile(
      transcript,
      [
        "garbage",
        JSON.stringify({ cwd: repoRoot, role: "user", content: "change auth" }),
        JSON.stringify({ cwd: repoRoot, role: "assistant", content: [{ type: "text", text: "Editing token file." }] }),
        JSON.stringify({
          cwd: repoRoot,
          role: "assistant",
          model: "claude-sonnet-4-5",
          sessionId: "s2",
          content: [
            {
              type: "tool_use",
              name: "Edit",
              input: { file_path: path.join(repoRoot, "token.ts"), new_string: "export const token = 1;" }
            }
          ]
        })
      ].join("\n"),
      "utf8"
    );
    const records = await parseTranscript(transcript, repoRoot);
    expect(records[0]).toMatchObject({ sessionId: "s2", userPromptExcerpt: "change auth", modelFamily: "anthropic" });
    expect(createHash("sha256").update("export const token = 1;").digest("hex")).toHaveLength(64);
  });
});
