import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DigestBlock, IntentBlock } from "./App.js";
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
});
