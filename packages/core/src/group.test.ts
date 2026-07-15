import { describe, expect, it } from "vitest";
import type { UndigestedHunk } from "./types.js";
import { assignGroups, enforceGroupingInvariant, groupingMismatches } from "./group.js";

function hunk(overrides: Partial<UndigestedHunk> = {}): UndigestedHunk {
  return {
    id: "docs-skim",
    file: "RELEASING.md",
    language: "markdown",
    header: "@@ -1,1 +1,1 @@",
    lines: [],
    addedLines: 1,
    removedLines: 0,
    category: "docs",
    categoryReason: "DEFAULT_DOCS",
    risk: 5,
    band: "skim",
    reasons: [],
    groupId: "",
    ...overrides
  };
}

describe("assignGroups", () => {
  it("puts a Skim-band documentation hunk in the Skim group", () => {
    const grouped = assignGroups([hunk()]);

    expect(grouped.hunks[0]?.groupId).toBe("skim");
    expect(grouped.groups).toContainEqual(
      expect.objectContaining({ id: "skim", title: "Skim", kind: "skim" })
    );
  });

  it("fails fast when a rendered group disagrees with the final band", () => {
    const mismatched = { ...hunk(), groupId: "medium-risk" };

    expect(groupingMismatches([mismatched])).toEqual(["docs-skim: medium-risk should be skim"]);
    expect(() => enforceGroupingInvariant([mismatched])).toThrow(/grouping invariant/u);
  });
});
