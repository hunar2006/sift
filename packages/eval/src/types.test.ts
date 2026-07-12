import { describe, expect, it } from "vitest";
import type { Hunk } from "@sift-review/core";
import { patchForHunk } from "./types.js";

describe("eval patch samples", () => {
  it("renders rename-only pseudo-hunks instead of an empty diff fence", () => {
    expect(patchForHunk(renameHunk())).toBe("renamed: src/old.ts → src/new.ts");
  });
});

function renameHunk(): Hunk {
  return {
    id: "rename",
    file: "src/new.ts",
    oldPath: "src/old.ts",
    language: "typescript",
    header: "RENAME_ONLY",
    lines: [],
    addedLines: 0,
    removedLines: 0,
    category: "mechanical",
    categoryReason: "RENAME_ONLY",
    risk: 0,
    band: "skim",
    reasons: [],
    groupId: "mechanical",
    isRenameOnly: true,
    digest: { headline: "Renames `old.ts` → `new.ts`", details: [], source: "auto" }
  };
}
