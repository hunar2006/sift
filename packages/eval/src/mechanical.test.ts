import { describe, expect, it } from "vitest";
import type { Hunk } from "@sift-review/core";
import { verifyMechanicalHonesty } from "./mechanical.js";

describe("independent mechanical checker", () => {
  it("rejects a directive comment misclassified as mechanical", () => {
    expect(verifyMechanicalHonesty(mechanicalDirective())).toContain("Directive comment must not be mechanical");
  });

  it("accepts a one-sided blank-line removal as whitespace-only", () => {
    expect(verifyMechanicalHonesty(blankLineRemoval())).toBeNull();
  });
});

function mechanicalDirective(): Hunk {
  return {
    id: "directive",
    file: "src/compat.ts",
    language: "typescript",
    header: "@@",
    lines: [{ kind: "add", text: "// @ts-ignore", newLine: 1 }],
    addedLines: 1,
    removedLines: 0,
    category: "mechanical",
    categoryReason: "COMMENT_ONLY",
    risk: 0,
    band: "skim",
    reasons: [],
    groupId: "mechanical",
    digest: { headline: "Comment-only change", details: [], source: "auto" }
  };
}

function blankLineRemoval(): Hunk {
  return {
    ...mechanicalDirective(),
    id: "blank-line",
    file: "middleware/content_type.go",
    language: "go",
    lines: [{ kind: "del", text: "", oldLine: 4 }],
    addedLines: 0,
    removedLines: 1,
    categoryReason: "WHITESPACE_ONLY"
  };
}
