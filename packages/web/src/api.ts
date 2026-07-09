import type { ApiMeta, ReviewModel, Status } from "./types.js";
import type { StatsSnapshot, StoredHunkState } from "@sift-review/core";

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

export async function setHunkStatus(id: string, status: Status, note?: string): Promise<StoredHunkState> {
  return checked<StoredHunkState>(
    await fetch(`/api/hunks/${encodeURIComponent(id)}/status`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status, note })
    })
  );
}

export async function approveGroup(groupId: string): Promise<{ approved: number }> {
  return checked<{ approved: number }>(
    await fetch(`/api/groups/${encodeURIComponent(groupId)}/approve`, { method: "POST" })
  );
}

export async function refreshReview(): Promise<ReviewModel> {
  return checked<ReviewModel>(await fetch("/api/refresh", { method: "POST" }));
}

export async function fetchFile(path: string, side: "old" | "new"): Promise<string> {
  const response = await fetch(`/api/file?path=${encodeURIComponent(path)}&side=${side}`);
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.text();
}
