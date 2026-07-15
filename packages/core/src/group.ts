import type { HunkGroup, UndigestedHunk } from "./types.js";
import { isLockfilePath } from "./classify/categories.js";

export interface GroupDefinition {
  id: string;
  title: string;
  kind: "attention" | "skim";
  order: number;
  accepts(hunk: UndigestedHunk): boolean;
}

const DEFINITIONS: GroupDefinition[] = [
  {
    id: "high-risk-logic",
    title: "High-risk logic",
    kind: "attention",
    order: 10,
    accepts: (hunk) => hunk.band === "high" && !isSkimBundled(hunk)
  },
  {
    id: "medium-risk",
    title: "Medium risk",
    kind: "attention",
    order: 20,
    accepts: (hunk) => hunk.band === "medium" && !isSkimBundled(hunk)
  },
  {
    id: "tests",
    title: "Tests",
    kind: "attention",
    order: 30,
    accepts: (hunk) => hunk.category === "tests" && hunk.band !== "high"
  },
  {
    id: "config-ci",
    title: "Config & CI",
    kind: "attention",
    order: 40,
    accepts: (hunk) => hunk.category === "config" && hunk.band !== "skim"
  },
  {
    id: "dependencies",
    title: "Dependencies",
    kind: "attention",
    order: 50,
    accepts: (hunk) => hunk.category === "deps" && !isLockfilePath(hunk.file)
  },
  {
    id: "low-risk-logic",
    title: "Low-risk logic",
    kind: "attention",
    order: 60,
    accepts: (hunk) => hunk.category === "logic" && hunk.band === "low"
  },
  {
    id: "docs",
    title: "Docs",
    kind: "attention",
    order: 70,
    accepts: (hunk) => hunk.category === "docs" && hunk.band !== "skim"
  },
  {
    id: "formatting-whitespace",
    title: "Formatting & whitespace",
    kind: "skim",
    order: 110,
    accepts: (hunk) =>
      hunk.category === "mechanical" &&
      ["WHITESPACE_ONLY", "ast-format-only", "COMMENT_ONLY"].includes(hunk.categoryReason)
  },
  {
    id: "import-reorders",
    title: "Import reorders",
    kind: "skim",
    order: 120,
    accepts: (hunk) => hunk.category === "mechanical" && hunk.categoryReason === "IMPORT_REORDER_ONLY"
  },
  {
    id: "renames",
    title: "Renames",
    kind: "skim",
    order: 130,
    accepts: (hunk) => hunk.category === "mechanical" && hunk.categoryReason === "RENAME_ONLY"
  },
  {
    id: "lockfiles",
    title: "Lockfiles",
    kind: "skim",
    order: 140,
    accepts: (hunk) =>
      hunk.category === "deps" &&
      isLockfilePath(hunk.file) &&
      !hunk.reasons.some((reason) => reason.weight >= 15)
  },
  {
    id: "generated-files",
    title: "Generated files",
    kind: "skim",
    order: 150,
    // Generated output remains a skim *group* even when a detector finds a
    // hot signal. `approveGroup` still refuses that bulk decision, which is
    // safer than hiding the hunk in a generic attention bucket.
    accepts: (hunk) => hunk.category === "generated" && !hunk.file.includes("__snapshots__")
  },
  {
    id: "snapshots",
    title: "Snapshots",
    kind: "skim",
    order: 160,
    accepts: (hunk) => hunk.category === "generated" && hunk.band === "skim" && hunk.file.includes("__snapshots__")
  },
  {
    id: "binary-assets",
    title: "Binary & assets",
    kind: "skim",
    order: 170,
    accepts: (hunk) => hunk.category === "binary" && hunk.band === "skim"
  },
  {
    id: "skim",
    title: "Skim",
    kind: "skim",
    order: 100,
    accepts: (hunk) => hunk.band === "skim"
  }
];

export function assignGroups(hunks: UndigestedHunk[]): { hunks: UndigestedHunk[]; groups: HunkGroup[] } {
  const hunkBuckets = new Map<string, UndigestedHunk[]>();
  const withGroups = hunks.map((hunk) => {
    const group = dynamicGroupForHunk(hunk) ?? groupForHunk(hunk);
    const grouped = { ...hunk, groupId: group.id };
    hunkBuckets.set(group.id, [...(hunkBuckets.get(group.id) ?? []), grouped]);
    return grouped;
  });

  const staticGroups = DEFINITIONS.flatMap<HunkGroup>((definition) => {
    const members = hunkBuckets.get(definition.id) ?? [];
    if (members.length === 0) {
      return [];
    }
    return {
      id: definition.id,
      title: definition.title,
      kind: definition.kind,
      order: definition.order,
      hunkIds: members.map((hunk) => hunk.id),
      totalAdded: members.reduce((sum, hunk) => sum + hunk.addedLines, 0),
      totalRemoved: members.reduce((sum, hunk) => sum + hunk.removedLines, 0)
    };
  });
  const dynamicGroups = [...hunkBuckets.entries()].flatMap<HunkGroup>(([id, members]) => {
    if (!id.startsWith("rename-pattern-")) {
      return [];
    }
    const title = renamePatternTitle(members[0]?.categoryReason ?? "");
    return {
      id,
      title,
      kind: "skim",
      order: 125,
      hunkIds: members.map((hunk) => hunk.id),
      totalAdded: members.reduce((sum, hunk) => sum + hunk.addedLines, 0),
      totalRemoved: members.reduce((sum, hunk) => sum + hunk.removedLines, 0)
    };
  });
  const groups = [...staticGroups, ...dynamicGroups].sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
  return { hunks: withGroups, groups };
}

/** The final classifier band/category is the sole source for queue membership. */
export function groupingMismatches(hunks: UndigestedHunk[]): string[] {
  return hunks.flatMap((hunk) => {
    const expected = groupDefinitionForHunk(hunk).id;
    return hunk.groupId === expected ? [] : [`${hunk.id}: ${hunk.groupId || "(none)"} should be ${expected}`];
  });
}

/**
 * Development and test builds fail loudly; production reassigns deterministically and warns once.
 * This makes a rendered score/band mismatch impossible to silently ship.
 */
export function enforceGroupingInvariant(hunks: UndigestedHunk[]): { hunks: UndigestedHunk[]; groups: HunkGroup[] } {
  const mismatches = groupingMismatches(hunks);
  if (mismatches.length === 0) {
    return assignGroups(hunks);
  }
  const detail = `Sift grouping invariant: ${mismatches.join("; ")}`;
  if (process.env.NODE_ENV !== "production") {
    throw new Error(detail);
  }
  console.error(`${detail}; reassigned from final band/category.`);
  return assignGroups(hunks);
}

export function groupForHunk(hunk: UndigestedHunk): GroupDefinition {
  return groupDefinitionForHunk(hunk);
}

function groupDefinitionForHunk(hunk: UndigestedHunk): GroupDefinition {
  const dynamic = dynamicGroupForHunk(hunk);
  if (dynamic) {
    return dynamic;
  }
  const skimDefinition = DEFINITIONS.find(
    (definition) =>
      definition.kind === "skim" &&
      (hunk.band === "skim" || isSkimEligible(hunk) || definition.id === "generated-files") &&
      definition.accepts(hunk)
  );
  if (skimDefinition) {
    return skimDefinition;
  }
  return (
    DEFINITIONS.find((definition) => definition.kind === "attention" && definition.accepts(hunk)) ?? {
      id: "medium-risk",
      title: "Medium risk",
      kind: "attention",
      order: 20,
      accepts: () => true
    }
  );
}

function isSkimEligible(hunk: UndigestedHunk): boolean {
  return (
    (hunk.band === "skim" &&
      (hunk.category === "mechanical" || hunk.category === "generated" || hunk.category === "binary")) ||
    (hunk.category === "deps" &&
      isLockfilePath(hunk.file) &&
      !hunk.reasons.some((reason) => reason.weight >= 15))
  );
}

function isSkimBundled(hunk: UndigestedHunk): boolean {
  return isSkimEligible(hunk);
}

function dynamicGroupForHunk(hunk: UndigestedHunk): GroupDefinition | null {
  if (!hunk.categoryReason.startsWith("RENAME_PATTERN:")) {
    return null;
  }
  const slug = hunk.categoryReason
    .slice("RENAME_PATTERN:".length)
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-|-$/g, "");
  return {
    id: `rename-pattern-${slug}`,
    title: renamePatternTitle(hunk.categoryReason),
    kind: "skim",
    order: 125,
    accepts: () => true
  };
}

function renamePatternTitle(reason: string): string {
  const mapping = reason.slice("RENAME_PATTERN:".length);
  const [from = "old", to = "new"] = mapping.split("->");
  return `Rename: ${from} -> ${to}`;
}
