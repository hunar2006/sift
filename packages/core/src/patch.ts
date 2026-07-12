import type { DiffLine, Hunk } from "./types.js";

type PatchRenderable = Pick<Hunk, "file" | "oldPath" | "isRenameOnly"> & { lines: DiffLine[] };

export function renderHunkPatch(hunk: PatchRenderable, maxLines = Number.POSITIVE_INFINITY): string {
  if (hunk.isRenameOnly && hunk.lines.length === 0) {
    return `renamed: ${hunk.oldPath ?? "unknown"} → ${hunk.file}`;
  }
  const lines = hunk.lines.map((line) => `${line.kind === "add" ? "+" : line.kind === "del" ? "-" : " "}${line.text}`);
  return [...lines.slice(0, maxLines), ...(lines.length > maxLines ? ["… truncated"] : [])].join("\n");
}
