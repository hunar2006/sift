import type { ApiMeta, ProvenanceTimelineSession, ReviewModel, Status } from "./types.js";
import type { ReviewBrief, StatsSnapshot, StoredHunkState } from "@sift-review/core";

async function checked<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return (await response.json()) as T;
}

export async function fetchReview(): Promise<ReviewModel> {
  return checked<ReviewModel>(await fetch("/api/review"));
}

export async function fetchStats(): Promise<StatsSnapshot> {
  return checked<StatsSnapshot>(await fetch("/api/stats"));
}

export async function fetchMeta(): Promise<ApiMeta> {
  return checked<ApiMeta>(await fetch("/api/meta"));
}

export async function fetchTimeline(): Promise<ProvenanceTimelineSession[]> {
  return checked<ProvenanceTimelineSession[]>(await fetch("/api/timeline"));
}

export async function fetchBrief(): Promise<ReviewBrief | null> {
  const response = await fetch("/api/brief");
  if (response.status === 404) {
    return null;
  }
  return checked<ReviewBrief>(response);
}

export async function setHunkStatus(id: string, status: Status, note?: string): Promise<StoredHunkState> {
  return checked<StoredHunkState>(
    await fetch(`/api/hunks/${encodeURIComponent(id)}/status`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status, note })
    })
  );
}

export type ApproveGroupResult =
  | { ok: true; approved: number }
  | { ok: false; blockedIds: string[] };

export async function approveGroup(groupId: string): Promise<ApproveGroupResult> {
  const response = await fetch(`/api/groups/${encodeURIComponent(groupId)}/approve`, { method: "POST" });
  if (response.status === 409) {
    const body = (await response.json().catch(() => ({}))) as { hunkIds?: string[] };
    return { ok: false, blockedIds: body.hunkIds ?? [] };
  }
  const parsed = await checked<{ approved: number }>(response);
  return { ok: true, approved: parsed.approved };
}

export async function refreshReview(): Promise<ReviewModel> {
  return checked<ReviewModel>(await fetch("/api/refresh", { method: "POST" }));
}

export async function openHunkInEditor(hunkId: string): Promise<void> {
  const response = await fetch("/api/open", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ hunkId })
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Editor could not be opened.");
  }
}

export async function fetchReport(): Promise<string> {
  const response = await fetch("/api/report?format=md");
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.text();
}

export async function fetchFile(path: string, side: "old" | "new"): Promise<string> {
  const response = await fetch(`/api/file?path=${encodeURIComponent(path)}&side=${side}`);
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.text();
}
