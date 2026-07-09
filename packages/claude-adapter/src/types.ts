export type { ProvenanceRecord } from "@sift-review/core";

export interface HookCapturePayload {
  sessionId: string;
  transcriptPath: string;
  cwd: string;
  toolName: string;
  filePath: string;
  newStrings: string[];
}
