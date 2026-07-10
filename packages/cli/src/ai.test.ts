import { describe, expect, it } from "vitest";
import type { Hunk, ReviewModel } from "@sift-review/core";
import { parseAnnotationJson, resolveAiProviders } from "./ai.js";

const hunk = (id: string, modelFamily?: "anthropic" | "openai" | "unknown"): Hunk => ({
  id,
  file: `${id}.ts`,
  language: "typescript",
  header: "@@",
  lines: [],
  addedLines: 1,
  removedLines: 0,
  category: "logic",
  categoryReason: "DEFAULT_LOGIC",
  risk: 70,
  band: "high",
  reasons: [],
  groupId: "high-risk-logic",
  digest: { headline: `Modifies \`${id}.ts\``, details: [], source: "auto" },
  provenance: modelFamily
    ? {
        source: "claude-code",
        sessionId: "s1",
        transcriptPath: "/tmp/s1.jsonl",
        matchedVia: "transcript-scan",
        confidence: 1,
        modelFamily
      }
    : undefined
});

const model = (...hunks: Hunk[]): Pick<ReviewModel, "hunks"> => ({ hunks });

describe("AI provider resolution", () => {
  it("uses the opposite provider for cross-model review when provenance is known", () => {
    expect(
      resolveAiProviders(model(hunk("a", "anthropic"), hunk("b", "anthropic")), "cross", {
        OPENAI_API_KEY: "openai-key"
      }).providers
    ).toEqual(["openai"]);
  });

  it("falls back to the only configured provider for cross-model review", () => {
    const resolution = resolveAiProviders(model(hunk("a", "openai")), "cross", {
      OPENAI_API_KEY: "openai-key"
    });

    expect(resolution.providers).toEqual(["openai"]);
    expect(resolution.reason).toContain("only configured provider");
  });

  it("supports same and both modes", () => {
    expect(
      resolveAiProviders(model(hunk("a", "openai")), "same", {
        OPENAI_API_KEY: "openai-key"
      }).providers
    ).toEqual(["openai"]);
    expect(
      resolveAiProviders(model(hunk("a", "unknown")), "both", {
        ANTHROPIC_API_KEY: "anthropic-key",
        OPENAI_API_KEY: "openai-key"
      }).providers
    ).toEqual(["anthropic", "openai"]);
  });

  it("rejects same mode without known generator family", () => {
    expect(() =>
      resolveAiProviders(model(hunk("a", "unknown")), "same", {
        OPENAI_API_KEY: "openai-key"
      })
    ).toThrow(/dominant provenance/);
  });
});

describe("parseAnnotationJson", () => {
  it("parses fenced JSON with drift", () => {
    expect(
      parseAnnotationJson(
        '```json\n[{"id":"h1","summary":"Adds auth checks.","concern":null,"drift":"It adds role checks not requested."}]\n```'
      )
    ).toEqual([
      {
        id: "h1",
        summary: "Adds auth checks.",
        concern: null,
        drift: "It adds role checks not requested."
      }
    ]);
  });
});
