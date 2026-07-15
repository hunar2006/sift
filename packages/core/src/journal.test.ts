import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { JOURNAL_LIMIT, appendJournal, journalPath, journalVerb, makeJournalEntry, readJournal } from "./journal.js";

const roots: string[] = [];

async function temporaryRepo(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "sift-journal-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function entry(index: number) {
  return makeJournalEntry({
    hunkId: `h${index}`,
    file: `src/${index}.ts`,
    via: "single",
    kind: "status",
    fromStatus: "unreviewed",
    toStatus: "flagged",
    toNote: "Needs tests"
  });
}

describe("decision journal", () => {
  it("BUG-09-journal-transition-verbs-and-stale-refusal", () => {
    expect(journalVerb({ kind: "status", fromStatus: "unreviewed", toStatus: "approved" })).toBe("Approved");
    expect(journalVerb({ kind: "status", fromStatus: "unreviewed", toStatus: "flagged", toNote: "Needs tests" })).toBe("Flagged (Needs tests)");
    expect(journalVerb({ kind: "status", fromStatus: "approved", toStatus: "unreviewed" })).toBe("Unapproved");
    expect(journalVerb({ kind: "status", fromStatus: "flagged", toStatus: "unreviewed" })).toBe("Unflagged");
    expect(journalVerb({ kind: "revert", fromStatus: "approved", toStatus: "unreviewed" })).toBe("Reverted");
  });

  it("recovers valid records when an interrupted line is malformed", async () => {
    const root = await temporaryRepo();
    await appendJournal(root, entry(1));
    await writeFile(journalPath(root), `${JSON.stringify(entry(2))}\n{bad json\n`, "utf8");

    expect(await readJournal(root)).toHaveLength(1);
  });

  it("keeps the most recent capped history", async () => {
    const root = await temporaryRepo();
    for (let index = 0; index < JOURNAL_LIMIT + 2; index += 1) {
      await appendJournal(root, entry(index));
    }

    const entries = await readJournal(root);
    expect(entries).toHaveLength(JOURNAL_LIMIT);
    expect(entries[0]?.hunkId).toBe("h2");
  });
});
