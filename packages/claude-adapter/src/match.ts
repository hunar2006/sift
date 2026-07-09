import {
  attachProvenanceRecords,
  defaultProvenanceRef,
  hashProvenanceLine,
  matchProvenanceRecords,
  type Hunk,
  type ProvenanceProvider,
  type ProvenanceRecord,
  type ProvenanceRef
} from "@sift-review/core";
import { loadHookLog, loadTranscriptRecords } from "./transcripts.js";

export const hashLine = hashProvenanceLine;

export class ClaudeProvenanceProvider implements ProvenanceProvider {
  async listRecords(repoRoot: string): Promise<ProvenanceRecord[]> {
    const hook = await loadHookLog(repoRoot);
    const transcript = await loadTranscriptRecords(repoRoot);
    return [...hook, ...transcript];
  }

  enrich(match: Parameters<ProvenanceProvider["enrich"]>[0]): ProvenanceRef {
    return defaultProvenanceRef(match);
  }
}

export function matchProvenance(hunks: Hunk[], records: ProvenanceRecord[]): Map<string, ProvenanceRef> {
  return matchProvenanceRecords(hunks, records, (match) => defaultProvenanceRef(match));
}

export function attachProvenance(hunks: Hunk[], records: ProvenanceRecord[]): Hunk[] {
  return attachProvenanceRecords(hunks, records, (match) => defaultProvenanceRef(match));
}
