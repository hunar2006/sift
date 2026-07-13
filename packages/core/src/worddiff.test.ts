import { describe, expect, it } from "vitest";
import { tokenizeWordDiff, wordDiffLines } from "./worddiff.js";

describe("wordDiffLines", () => {
  it("pairs adjacent deleted and added lines and marks only changed token spans", () => {
    const [removed, added] = wordDiffLines([
      { kind: "del", text: "const retryCount = 3;" },
      { kind: "add", text: "const retryLimit = 5;" }
    ]);

    expect(removed?.segments).toEqual([
      { text: "const ", changed: false },
      { text: "retryCount", changed: true },
      { text: " = ", changed: false },
      { text: "3", changed: true },
      { text: ";", changed: false }
    ]);
    expect(added?.segments?.filter((segment) => segment.changed).map((segment) => segment.text)).toEqual([
      "retryLimit",
      "5"
    ]);
  });

  it("pairs overlapping runs and leaves extras unpaired", () => {
    const lines = wordDiffLines([
      { kind: "del", text: "return oldValue;" },
      { kind: "del", text: "return removedOnly;" },
      { kind: "add", text: "return newValue;" }
    ]);

    expect(lines[0]?.segments).toBeDefined();
    expect(lines[1]?.segments).toBeUndefined();
    expect(lines[2]?.segments).toBeDefined();
  });

  it("tokenizes identifiers and numbers as units while preserving whitespace and punctuation", () => {
    expect(tokenizeWordDiff("user_id += 12.5;")).toEqual(["user_id", " ", "+", "=", " ", "12.5", ";"]);
  });

  it("is deterministic", () => {
    const input = [
      { kind: "del" as const, text: "if (enabled && count > 2) return count;" },
      { kind: "add" as const, text: "if (enabled && count > 3) return limit;" }
    ];
    expect(wordDiffLines(input)).toEqual(wordDiffLines(input));
  });

  it("skips lines and hunks outside the bounded comparison guards", () => {
    const long = "x".repeat(1001);
    expect(wordDiffLines([{ kind: "del", text: long }, { kind: "add", text: long }])[0]?.segments).toBeUndefined();

    const large = Array.from({ length: 401 }, (_, index) => ({
      kind: index % 2 === 0 ? ("del" as const) : ("add" as const),
      text: "const stable = true;"
    }));
    expect(wordDiffLines(large).every((line) => line.segments === undefined)).toBe(true);

    expect(
      wordDiffLines([{ kind: "del", text: "alpha beta gamma" }, { kind: "add", text: "one two three" }])[0]?.segments
    ).toBeUndefined();
  });
});
