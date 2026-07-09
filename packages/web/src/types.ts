import type { HunkWithState, ReviewModelWithState, StatsSnapshot } from "@sift-review/core";
import type { TimelineSession } from "@sift-review/core";

export type ReviewModel = ReviewModelWithState;
export type ReviewHunk = HunkWithState;
export type Status = ReviewHunk["status"];

export interface ApiMeta {
  version: string;
  repoRoot: string;
  diffSpec: string;
  counts: ReviewModelWithState["totals"];
  provenanceSourcesFound: boolean;
  aiRan: boolean;
}

export interface AppData {
  model: ReviewModel;
  stats: StatsSnapshot;
  meta: ApiMeta;
}

export type ProvenanceTimelineSession = TimelineSession;
