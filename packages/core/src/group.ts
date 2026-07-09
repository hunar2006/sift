import type { Hunk, HunkGroup } from "./types.js";
import { isLockfilePath } from "./classify/categories.js";

interface GroupDefinition {
  id: string;
  title: string;
  kind: "attention" | "skim";
  order: number;
  accepts(hunk: Hunk): boolean;
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
    accepts: (hunk) => hunk.category === "mechanical" && hunk.categoryReason === "WHITESPACE_ONLY"
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
    accepts: (hunk) => hunk.category === "deps" && isLockfilePath(hunk.file) && hunk.band === "skim"
  },
  {
    id: "generated-files",
    title: "Generated files",
    kind: "skim",
    order: 150,
    accepts: (hunk) => hunk.category === "generated" && hunk.band === "skim" && !hunk.file.includes("__snapshots__")
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
  }
];

export function assignGroups(hunks: Hunk[]): { hunks: Hunk[]; groups: HunkGroup[] } {
  const hunkBuckets = new Map<string, Hunk[]>();
  const withGroups = hunks.map((hunk) => {
    const group = groupForHunk(hunk);
    const grouped = { ...hunk, groupId: group.id };
    hunkBuckets.set(group.id, [...(hunkBuckets.get(group.id) ?? []), grouped]);
    return grouped;
  });

  const groups = DEFINITIONS.flatMap<HunkGroup>((definition) => {
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
  return { hunks: withGroups, groups };
}

export function groupForHunk(hunk: Hunk): GroupDefinition {
  const skimDefinition = DEFINITIONS.find(
    (definition) => definition.kind === "skim" && isSkimEligible(hunk) && definition.accepts(hunk)
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

function isSkimEligible(hunk: Hunk): boolean {
  return (
    hunk.band === "skim" &&
    (hunk.category === "mechanical" ||
      hunk.category === "generated" ||
      hunk.category === "binary" ||
      (hunk.category === "deps" && isLockfilePath(hunk.file)))
  );
}

function isSkimBundled(hunk: Hunk): boolean {
  return isSkimEligible(hunk);
}
