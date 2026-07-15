import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { HunkStatus } from "./types.js";

export const JOURNAL_LIMIT = 500;

export type JournalKind = "status" | "group" | "revert";

/** Durable, append-only review-decision record. Extra fields make targeted undo exact. */
export interface JournalEntry {
  id: string;
  ts: string;
  hunkId: string;
  file: string;
  action: string;
  via: string;
  note?: string;
  kind: JournalKind;
  compoundId?: string;
  fromStatus: HunkStatus;
  fromNote?: string;
  toStatus: HunkStatus;
  toNote?: string;
}

export function journalPath(repoRoot: string): string {
  return path.join(repoRoot, ".sift", "journal.jsonl");
}

export function createJournalId(): string {
  return randomUUID();
}

export function makeJournalEntry(
  input: Omit<JournalEntry, "id" | "ts" | "action"> & Pick<Partial<JournalEntry>, "id" | "ts" | "action">
): JournalEntry {
  return {
    ...input,
    id: input.id ?? createJournalId(),
    ts: input.ts ?? new Date().toISOString(),
    action: input.action ?? journalVerb(input)
  };
}

/** Human history reports the decision made, never a raw state-arrow. */
export function journalVerb(input: Pick<JournalEntry, "kind" | "fromStatus" | "toStatus" | "note" | "toNote">): string {
  if (input.kind === "revert") {
    return "Reverted";
  }
  if (input.toStatus === "approved") {
    return "Approved";
  }
  if (input.toStatus === "flagged") {
    const note = input.toNote ?? input.note;
    return note?.trim() ? `Flagged (${note.trim()})` : "Flagged";
  }
  if (input.toStatus === "unreviewed" && input.fromStatus === "approved") {
    return "Unapproved";
  }
  if (input.toStatus === "unreviewed" && input.fromStatus === "flagged") {
    return "Unflagged";
  }
  return "Updated decision";
}

/** Ignores malformed lines so one interrupted write never hides valid history. */
export async function readJournal(repoRoot: string): Promise<JournalEntry[]> {
  try {
    const raw = await fs.readFile(journalPath(repoRoot), "utf8");
    return raw
      .split(/\r?\n/u)
      .filter(Boolean)
      .flatMap((line) => {
        try {
          const entry = JSON.parse(line) as unknown;
          return isJournalEntry(entry) ? [entry] : [];
        } catch {
          return [];
        }
      });
  } catch (error) {
    if (isMissingFile(error)) {
      return [];
    }
    return [];
  }
}

/** Appends and fsyncs a line, then atomically compacts only when the cap is exceeded. */
export async function appendJournal(repoRoot: string, entry: JournalEntry): Promise<void> {
  const file = journalPath(repoRoot);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const handle = await fs.open(file, "a");
  try {
    await handle.writeFile(`${JSON.stringify(entry)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  const entries = await readJournal(repoRoot);
  if (entries.length > JOURNAL_LIMIT) {
    await writeJournal(repoRoot, entries.slice(-JOURNAL_LIMIT));
  }
}

export async function writeJournal(repoRoot: string, entries: JournalEntry[]): Promise<void> {
  const file = journalPath(repoRoot);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  const handle = await fs.open(temp, "w");
  try {
    await handle.writeFile(entries.map((entry) => JSON.stringify(entry)).join("\n") + (entries.length ? "\n" : ""), "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(temp, file);
}

function isJournalEntry(value: unknown): value is JournalEntry {
  if (!value || typeof value !== "object") {
    return false;
  }
  const entry = value as Partial<JournalEntry>;
  return (
    typeof entry.id === "string" &&
    typeof entry.ts === "string" &&
    typeof entry.hunkId === "string" &&
    typeof entry.file === "string" &&
    typeof entry.action === "string" &&
    typeof entry.via === "string" &&
    typeof entry.kind === "string" &&
    isStatus(entry.fromStatus) &&
    isStatus(entry.toStatus)
  );
}

function isStatus(value: unknown): value is HunkStatus {
  return value === "unreviewed" || value === "approved" || value === "flagged";
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ENOENT";
}
