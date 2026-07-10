import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ReviewBrief } from "@sift-review/core";
import { Briefing, DigestBlock, IntentBlock } from "./App.js";
import type { ReviewHunk } from "./types.js";

const provenance: NonNullable<ReviewHunk["provenance"]> = {
  source: "claude-code",
  sessionId: "abcdef1234",
  transcriptPath: "/tmp/s.jsonl",
  matchedVia: "transcript-scan",
  confidence: 0.82,
  userPromptExcerpt: "rotate the refresh token on every login",
  reasoningExcerpt: "Added a rotation helper and updated the session store to call it."
};

const hunk = {
  digest: {
    headline: "Adds `rotate()` (+24 lines)",
    details: ["Disables TLS certificate verification", "0 of 12 changed lines covered"],
    source: "auto"
  }
} as unknown as ReviewHunk;

describe("Intent surfacing", () => {
  it("renders the digest headline and details with inline code", () => {
    const html = renderToStaticMarkup(<DigestBlock hunk={hunk} />);
    expect(html).toContain("<code>rotate()</code>");
    expect(html).toContain("Disables TLS certificate verification");
    expect(html).toContain("0 of 12 changed lines covered");
  });

  it("renders Asked/Agent lines, source chip, and line match", () => {
    const html = renderToStaticMarkup(<IntentBlock provenance={provenance} />);
    expect(html).toContain("Asked");
    expect(html).toContain("Agent");
    expect(html).toContain("rotate the refresh token on every login");
    expect(html).toContain("Claude Code");
    expect(html).toContain("line match 82%");
  });

  it("renders the AI second-headline as a labeled line, not replacing the digest", () => {
    const annotated = {
      digest: { headline: "Adds `rotate()`", details: [], source: "auto" },
      aiAnnotations: [
        { provider: "anthropic", model: "claude-sonnet-4-6", summary: "Rotates the refresh token.", concern: null, drift: null }
      ]
    } as unknown as ReviewHunk;
    const html = renderToStaticMarkup(<DigestBlock hunk={annotated} />);
    expect(html).toContain("rotate()");
    expect(html).toContain("AI · Anthropic");
    expect(html).toContain("Rotates the refresh token.");
  });

  it("renders an AI-labeled briefing bar with story and reading hint", () => {
    const brief: ReviewBrief = {
      story: "Rotates refresh tokens across the auth module and updates the session store.",
      readingHint: "Start in auth.ts",
      provider: "anthropic",
      model: "claude-sonnet-4-6"
    };
    const html = renderToStaticMarkup(<Briefing brief={brief} diffKey="WORKTREE:abc" />);
    expect(html).toContain("AI · Anthropic");
    expect(html).toContain("Rotates refresh tokens across the auth module");
    expect(html).toContain("Start in auth.ts");
  });
});
