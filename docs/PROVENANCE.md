# Sift Provenance

Sift reads provenance records from `~/.sift/provenance.jsonl`. This open JSONL format is the sanctioned integration path for Cursor, Copilot, Codex, and other agent CLIs until first-party adapters exist.

Each line is one JSON object:

```json
{
  "source": "codex",
  "sessionId": "session-123",
  "transcriptPath": "/absolute/path/to/session.jsonl",
  "cwd": "/repo/root",
  "ts": "2026-01-01T00:00:00.000Z",
  "tool": "edit",
  "file": "/repo/root/src/auth.ts",
  "newStrings": ["export const enabled = true;"],
  "addedHashes": [],
  "userPromptExcerpt": "Add a feature flag",
  "reasoningExcerpt": "Editing auth flag module",
  "modelFamily": "openai"
}
```

Fields:

- `source` is required and identifies the tool, for example `codex`, `cursor`, or `copilot`.
- `sessionId` is required when known; use a stable run id, or `unknown`.
- `file` or `filePath` is required and should be absolute when possible.
- `newStrings` may contain exact inserted text; Sift hashes this locally.
- `addedHashes` may contain SHA-256 hashes of inserted lines instead of raw text.
- `cwd`, `ts`, `tool`, `transcriptPath`, `userPromptExcerpt`, `reasoningExcerpt`, and `modelFamily` are optional.
- `modelFamily` may be `anthropic`, `openai`, or `unknown`.

Example wrapper:

```js
import { createHash } from "node:crypto";
import { mkdirSync, appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const [, , file, ...parts] = process.argv;
const text = parts.join(" ");
const log = join(process.env.SIFT_HOME ?? join(homedir(), ".sift"), "provenance.jsonl");
const addedHashes = text.split(/\r?\n/).filter(Boolean).map((line) =>
  createHash("sha256").update(line.trimEnd()).digest("hex")
);
mkdirSync(dirname(log), { recursive: true });
appendFileSync(log, `${JSON.stringify({
  source: "codex",
  sessionId: process.env.CODEX_SESSION_ID ?? "unknown",
  cwd: process.cwd(),
  ts: new Date().toISOString(),
  tool: "wrapper-edit",
  file: resolve(file),
  addedHashes
})}\n`);
```
