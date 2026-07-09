import { createHash } from "node:crypto";
import type { ParsedHunk } from "./types.js";

export function baseHunkId(hunk: Pick<ParsedHunk, "file" | "lines" | "header">): string {
  const changed = hunk.lines
    .filter((line) => line.kind !== "context")
    .map((line) => {
      const prefix = line.kind === "add" ? "+" : "-";
      return `${prefix}${line.text.replace(/\s+$/u, "").replace(/\t/gu, "  ")}`;
    });
  const normalizedChange = changed.length > 0 ? changed.join("\n") : hunk.header;
  const digest = createHash("sha256").update(`${hunk.file}\n${normalizedChange}`).digest("hex");
  return `h_${digest.slice(0, 16)}`;
}

export function assignHunkIds<T extends ParsedHunk>(hunks: T[]): Array<T & { id: string }> {
  const seen = new Map<string, number>();
  return hunks.map((hunk) => {
    const base = baseHunkId(hunk);
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    const id = count === 1 ? base : `${base}~${count}`;
    return { ...hunk, id };
  });
}
