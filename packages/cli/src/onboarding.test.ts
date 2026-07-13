import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  CLEAN_WORKTREE_HINT,
  cleanWorktreePickerInfo,
  emptyReviewMessage,
  ensureLastHistory,
  isInteractiveTerminal,
  lastCount,
  lastRange,
  pickCleanWorktree,
  pipelineTargetFor
} from "./onboarding.js";

function pickerIo(answer: string) {
  const input = new PassThrough();
  const output = new PassThrough();
  input.end(answer);
  return { input, output };
}

describe("clean-worktree onboarding", () => {
  it("maps a stdin picker choice to the last-commit diff", async () => {
    const io = pickerIo("1\n");
    const selection = await pickCleanWorktree({ lastSubject: "Fix parser", hasStagedChanges: false }, io);
    expect(pipelineTargetFor(selection)).toEqual({ range: "HEAD~1..HEAD" });
  });

  it("accepts a typed range from stdin", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const pending = pickCleanWorktree({ lastSubject: "Fix parser", hasStagedChanges: false }, { input, output });
    input.write("3\n");
    setTimeout(() => input.end("origin/main..HEAD\n"), 1);
    const selection = await pending;
    expect(pipelineTargetFor(selection)).toEqual({ range: "origin/main..HEAD" });
  });

  it("keeps the non-TTY fallback concise", () => {
    expect(isInteractiveTerminal({ input: { isTTY: false }, output: { isTTY: false } } as never)).toBe(false);
    expect(emptyReviewMessage()).toBe(`Nothing to review.\n${CLEAN_WORKTREE_HINT}`);
  });

  it("builds last ranges and rejects short history", async () => {
    expect(lastCount(undefined)).toBe(1);
    expect(lastRange(lastCount("3"))).toBe("HEAD~3..HEAD");
    await expect(ensureLastHistory("repo", 3, () => Promise.resolve("3\n"))).rejects.toThrow("history is shorter than 3");
  });

  it("reads compact picker facts from git", async () => {
    const seen: string[][] = [];
    const info = await cleanWorktreePickerInfo("repo", (args) => {
      seen.push(args);
      return Promise.resolve(args[0] === "log" ? "Tighten onboarding\n" : "file.ts\n");
    });
    expect(info).toEqual({ lastSubject: "Tighten onboarding", hasStagedChanges: true });
    expect(seen).toEqual([["log", "-1", "--format=%s"], ["diff", "--cached", "--name-only"]]);
  });
});
