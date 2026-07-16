import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { parsePullRequestChoice, pickPullRequest, pullRequestPickerLines, truncateTitle } from "./github.js";

const pullRequests = [
  { number: 123, title: "Tighten onboarding copy", author: "reviewer" },
  { number: 456, title: "Add a title that is deliberately long enough to need truncating in the compact picker", author: "sift-bot" }
];

describe("pull request picker", () => {
  it("formats compact numbered rows", () => {
    expect(pullRequestPickerLines(pullRequests)).toEqual([
      "  1  #123 · Tighten onboarding copy (reviewer)",
      "  2  #456 · Add a title that is deliberately long enough to need trun... (sift-bot)"
    ]);
    expect(truncateTitle("x".repeat(61))).toHaveLength(60);
  });

  it("parses a picker choice", () => {
    expect(parsePullRequestChoice("2", pullRequests)).toBe("456");
    expect(parsePullRequestChoice("q", pullRequests)).toBeUndefined();
  });

  it("reads a selection from stdin", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const pending = pickPullRequest(pullRequests, { input, output });
    input.end("1\n");
    await expect(pending).resolves.toBe("123");
  });
});
