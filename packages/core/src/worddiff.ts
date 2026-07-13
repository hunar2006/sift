import type { DiffLine, ReviewModel } from "./types.js";

export interface WordDiffSegment {
  text: string;
  changed: boolean;
}

const MAX_LINE_LENGTH = 1000;
const MAX_CHANGED_LINES = 400;
const MIN_OVERLAP = 0.2;

/**
 * Add word-level change segments to adjacent delete/add runs. This is invoked
 * only while serialising a review response, leaving analysis artifacts compact.
 */
export function withWordDiffSegments(model: ReviewModel): ReviewModel {
  return {
    ...model,
    hunks: model.hunks.map((hunk) => ({ ...hunk, lines: wordDiffLines(hunk.lines) }))
  };
}

export function wordDiffLines(lines: DiffLine[]): DiffLine[] {
  if (lines.filter((line) => line.kind === "add" || line.kind === "del").length > MAX_CHANGED_LINES) {
    return lines;
  }
  const next: DiffLine[] = lines.map(({ segments: _segments, ...line }) => line);
  for (let start = 0; start < lines.length; ) {
    if (lines[start]?.kind !== "add" && lines[start]?.kind !== "del") {
      start += 1;
      continue;
    }
    let end = start;
    const removed: number[] = [];
    const added: number[] = [];
    while (end < lines.length && (lines[end]?.kind === "add" || lines[end]?.kind === "del")) {
      if (lines[end]?.kind === "del") removed.push(end);
      if (lines[end]?.kind === "add") added.push(end);
      end += 1;
    }
    for (let pair = 0; pair < Math.min(removed.length, added.length); pair += 1) {
      const oldIndex = removed[pair]!;
      const newIndex = added[pair]!;
      const segments = wordDiffPair(lines[oldIndex]!.text, lines[newIndex]!.text);
      if (segments) {
        next[oldIndex] = { ...next[oldIndex]!, segments: segments.old };
        next[newIndex] = { ...next[newIndex]!, segments: segments.next };
      }
    }
    start = end;
  }
  return next;
}

export function tokenizeWordDiff(text: string): string[] {
  return text.match(/[A-Za-z_$][A-Za-z0-9_$]*|\d+(?:\.\d+)?|\s+|[^\s]/gu) ?? [];
}

function wordDiffPair(oldText: string, newText: string): { old: WordDiffSegment[]; next: WordDiffSegment[] } | undefined {
  if (oldText.length > MAX_LINE_LENGTH || newText.length > MAX_LINE_LENGTH) {
    return undefined;
  }
  const oldTokens = tokenizeWordDiff(oldText);
  const newTokens = tokenizeWordDiff(newText);
  if (oldTokens.length === 0 || newTokens.length === 0) {
    return undefined;
  }
  const [oldShared, newShared] = sharedTokenIndexes(oldTokens, newTokens);
  const sharedContent = [...oldShared].filter((index) => isContentToken(oldTokens[index]!)).length;
  const overlap = sharedContent / Math.max(contentTokenCount(oldTokens), contentTokenCount(newTokens));
  if (overlap < MIN_OVERLAP) {
    return undefined;
  }
  return {
    old: segmentsFor(oldTokens, oldShared),
    next: segmentsFor(newTokens, newShared)
  };
}

function isContentToken(token: string): boolean {
  return /[A-Za-z0-9_$]/u.test(token);
}

function contentTokenCount(tokens: string[]): number {
  return tokens.filter(isContentToken).length;
}

function sharedTokenIndexes(oldTokens: string[], newTokens: string[]): [Set<number>, Set<number>] {
  const width = newTokens.length + 1;
  const table = Array.from({ length: oldTokens.length + 1 }, () => new Uint16Array(width));
  for (let oldIndex = oldTokens.length - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = newTokens.length - 1; newIndex >= 0; newIndex -= 1) {
      table[oldIndex]![newIndex] =
        oldTokens[oldIndex] === newTokens[newIndex]
          ? table[oldIndex + 1]![newIndex + 1]! + 1
          : Math.max(table[oldIndex + 1]![newIndex]!, table[oldIndex]![newIndex + 1]!);
    }
  }
  const oldShared = new Set<number>();
  const newShared = new Set<number>();
  for (let oldIndex = 0, newIndex = 0; oldIndex < oldTokens.length && newIndex < newTokens.length; ) {
    if (oldTokens[oldIndex] === newTokens[newIndex]) {
      oldShared.add(oldIndex);
      newShared.add(newIndex);
      oldIndex += 1;
      newIndex += 1;
    } else if (table[oldIndex + 1]![newIndex]! >= table[oldIndex]![newIndex + 1]!) {
      oldIndex += 1;
    } else {
      newIndex += 1;
    }
  }
  return [oldShared, newShared];
}

function segmentsFor(tokens: string[], shared: Set<number>): WordDiffSegment[] {
  return tokens.reduce<WordDiffSegment[]>((segments, text, index) => {
    const changed = !shared.has(index);
    const previous = segments[segments.length - 1];
    if (previous && previous.changed === changed) {
      previous.text += text;
    } else {
      segments.push({ text, changed });
    }
    return segments;
  }, []);
}
