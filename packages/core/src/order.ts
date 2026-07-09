import type { Hunk, HunkGroup } from "./types.js";

export function orderReview(hunks: Hunk[], groups: HunkGroup[]): { hunks: Hunk[]; groups: HunkGroup[] } {
  const groupOrder = new Map(groups.map((group) => [group.id, group.order]));
  const orderedHunks = [...hunks].sort((a, b) => {
    const groupDelta = (groupOrder.get(a.groupId) ?? 999) - (groupOrder.get(b.groupId) ?? 999);
    if (groupDelta !== 0) {
      return groupDelta;
    }
    if (b.risk !== a.risk) {
      return b.risk - a.risk;
    }
    const fileDelta = a.file.localeCompare(b.file);
    if (fileDelta !== 0) {
      return fileDelta;
    }
    return (a.newStart ?? a.oldStart ?? 0) - (b.newStart ?? b.oldStart ?? 0);
  });
  const orderedIds = new Map(orderedHunks.map((hunk, index) => [hunk.id, index]));
  const orderedGroups = [...groups]
    .sort((a, b) => a.order - b.order)
    .map((group) => ({
      ...group,
      hunkIds: [...group.hunkIds].sort((a, b) => (orderedIds.get(a) ?? 0) - (orderedIds.get(b) ?? 0))
    }));
  return { hunks: orderedHunks, groups: orderedGroups };
}
