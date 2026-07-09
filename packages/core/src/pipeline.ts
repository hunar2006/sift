import type { AnalyzeOptions, FileChange, Hunk, ParsedHunk, ReviewModel } from "./types.js";
import { SIFT_VERSION } from "./brand.js";
import { HeuristicClassifier } from "./classify/index.js";
import { classifyHunk } from "./classify/categories.js";
import { scopeKeyForPath } from "./classify/signals.js";
import { assignHunkIds } from "./identity.js";
import { parseUnifiedDiff } from "./parse.js";
import { assignGroups } from "./group.js";
import { assignReadingRanks, orderReview } from "./order.js";
import { attachCoverageToHunks } from "./coverage.js";
import { applyRenamePatternGroups, enrichParsedHunksWithStructure } from "./structure/index.js";

export function analyzeDiff(options: AnalyzeOptions): ReviewModel {
  const parsed = parseUnifiedDiff(options.patch);
  const parsedHunks = enrichParsedHunksWithStructure(
    attachCoverageToHunks(synthesizeQueueHunks(parsed.files, parsed.hunks), options.coverage)
  );
  const identified = assignHunkIds(parsedHunks);
  const classifier = new HeuristicClassifier();
  const generatedPaths = options.generatedPaths ?? new Set<string>();
  const testScopes = testScopesFor(identified, generatedPaths);
  const hasCoverageData = identified.some((hunk) => Boolean(hunk.coverage));
  const hunks = identified.map((hunk) =>
    classifier.classify(hunk, generatedPaths, undefined, { testScopes, hasCoverageData, rules: options.rules })
  );
  const structuralHunks = applyRenamePatternGroups(hunks);
  const { hunks: groupedHunks, groups } = assignGroups(structuralHunks);
  const rankedHunks = assignReadingRanks(groupedHunks, groups);
  const ordered = orderReview(rankedHunks, groups);
  const hunkIdsByFile = new Map<string, string[]>();
  for (const hunk of ordered.hunks) {
    hunkIdsByFile.set(hunk.file, [...(hunkIdsByFile.get(hunk.file) ?? []), hunk.id]);
  }
  const files = parsed.files.map<FileChange>((file) => ({
    ...file,
    hunkIds: hunkIdsByFile.get(file.path) ?? []
  }));
  return {
    meta: {
      siftVersion: SIFT_VERSION,
      repoRoot: options.repoRoot,
      diffSpec: options.diffSpec,
      generatedAt: new Date().toISOString(),
      git: options.git
    },
    files,
    hunks: ordered.hunks,
    groups: ordered.groups,
    totals: totalsFor(ordered.hunks, ordered.groups)
  };
}

function testScopesFor(hunks: ParsedHunk[], generatedPaths: Set<string>): Set<string> {
  const scopes = new Set<string>();
  for (const hunk of hunks) {
    if (classifyHunk(hunk, [], generatedPaths).category === "tests") {
      scopes.add(scopeKeyForPath(hunk.file));
    }
  }
  return scopes;
}

function synthesizeQueueHunks(files: FileChange[], hunks: ParsedHunk[]): ParsedHunk[] {
  const existingByFile = new Map<string, number>();
  for (const hunk of hunks) {
    existingByFile.set(hunk.file, (existingByFile.get(hunk.file) ?? 0) + 1);
  }
  const synthetic = files.flatMap<ParsedHunk>((file) => {
    if (existingByFile.has(file.path) || file.status !== "binary") {
      return [];
    }
    return {
      file: file.path,
      oldPath: file.oldPath,
      language: "binary",
      header: "BINARY_FILE",
      lines: [],
      addedLines: 0,
      removedLines: 0,
      parserReasons: [],
      isBinary: true
    };
  });
  return [...hunks, ...synthetic];
}

function totalsFor(hunks: Hunk[], groups: ReviewModel["groups"]): ReviewModel["totals"] {
  const attentionGroupIds = new Set(groups.filter((group) => group.kind === "attention").map((group) => group.id));
  return {
    changedLines: hunks.reduce((sum, hunk) => sum + hunk.addedLines + hunk.removedLines, 0),
    attentionLines: hunks
      .filter((hunk) => hunk.band === "high" || hunk.band === "medium")
      .reduce((sum, hunk) => sum + hunk.addedLines + hunk.removedLines, 0),
    reviewableLines: hunks
      .filter((hunk) => attentionGroupIds.has(hunk.groupId))
      .reduce((sum, hunk) => sum + hunk.addedLines + hunk.removedLines, 0),
    files: new Set(hunks.map((hunk) => hunk.file)).size
  };
}
