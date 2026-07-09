export interface ProvenanceRecord {
  source: "hook-log" | "transcript-scan";
  sessionId: string;
  transcriptPath: string;
  cwd?: string;
  ts?: string;
  toolName?: string;
  filePath: string;
  newStrings?: string[];
  addedHashes?: string[];
  userPromptExcerpt?: string;
  reasoningExcerpt?: string;
}

export interface HookCapturePayload {
  sessionId: string;
  transcriptPath: string;
  cwd: string;
  toolName: string;
  filePath: string;
  newStrings: string[];
}
