import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FileChange } from "./types.js";
import { analyzeDiff } from "./pipeline.js";
import { loadCoverage, parseCobertura, parseLcov } from "./coverage.js";
import { computeStats } from "./stats.js";
import { emptyState } from "./state.js";

describe("coverage ingest", () => {
  it("parses lcov DA records and maps covered added lines onto hunks", async () => {
    const repoRoot = await tempRepo();
    await writeRepoFile(repoRoot, "src/app.ts", "const existing = true;\nconst covered = 1;\nconst missed = 2;\n");
    await writeRepoFile(
      repoRoot,
      "coverage/lcov.info",
      `TN:
SF:src/app.ts
DA:2,1
DA:3,0
end_of_record
`
    );

    const loaded = await loadCoverage(repoRoot, [fileChange("src/app.ts")]);
    const model = analyzeDiff({
      repoRoot,
      diffSpec: "WORKTREE",
      git: { headSha: "abc", branch: "main" },
      coverage: loaded.coverage,
      patch: patchFor("src/app.ts", ["const covered = 1;", "const missed = 2;"])
    });
    const stats = computeStats(model, emptyState());

    expect(loaded.coverage?.format).toBe("lcov");
    expect(model.hunks[0]?.coverage).toEqual({ covered: 1, total: 2, stale: false });
    expect(stats.coverageOnChangedLines).toBe(0.5);
  });

  it("parses Cobertura XML and applies the covered-change reducer only when fresh", async () => {
    const repoRoot = await tempRepo();
    await writeRepoFile(repoRoot, "src/app.ts", Array.from({ length: 6 }, (_, index) => `const line${index} = ${index};`).join("\n"));
    await writeRepoFile(repoRoot, "coverage/cobertura.xml", cobertura("src/app.ts", [2, 3, 4, 5, 6], 1));

    const loaded = await loadCoverage(repoRoot, [fileChange("src/app.ts")], "coverage/cobertura.xml");
    const model = analyzeDiff({
      repoRoot,
      diffSpec: "WORKTREE",
      git: { headSha: "abc", branch: "main" },
      coverage: loaded.coverage,
      patch: patchFor(
        "src/app.ts",
        Array.from({ length: 5 }, (_, index) => `const line${index + 1} = ${index + 1};`)
      )
    });

    expect(loaded.coverage?.format).toBe("cobertura");
    expect(model.hunks[0]?.coverage).toEqual({ covered: 5, total: 5, stale: false });
    expect(model.hunks[0]?.reasons.map((reason) => reason.code)).toContain("COVERED_CHANGE");
  });

  it("marks stale artifacts and withholds the covered-change reducer", async () => {
    const repoRoot = await tempRepo();
    await writeRepoFile(repoRoot, "src/app.ts", Array.from({ length: 6 }, (_, index) => `const line${index} = ${index};`).join("\n"));
    const artifact = await writeRepoFile(repoRoot, "coverage/lcov.info", lcov("src/app.ts", [2, 3, 4, 5, 6], 1));
    const old = new Date("2000-01-01T00:00:00.000Z");
    await fs.utimes(artifact, old, old);

    const loaded = await loadCoverage(repoRoot, [fileChange("src/app.ts")], "coverage/lcov.info");
    const model = analyzeDiff({
      repoRoot,
      diffSpec: "WORKTREE",
      git: { headSha: "abc", branch: "main" },
      coverage: loaded.coverage,
      patch: patchFor(
        "src/app.ts",
        Array.from({ length: 5 }, (_, index) => `const line${index + 1} = ${index + 1};`)
      )
    });

    expect(model.hunks[0]?.coverage).toEqual({ covered: 5, total: 5, stale: true });
    expect(model.hunks[0]?.reasons.map((reason) => reason.code)).not.toContain("COVERED_CHANGE");
  });

  it("uses .sift/config.json coverage paths before autodetect defaults", async () => {
    const repoRoot = await tempRepo();
    await writeRepoFile(repoRoot, "src/app.ts", "const existing = true;\nconst covered = 1;\n");
    await writeRepoFile(repoRoot, ".sift/config.json", JSON.stringify({ coverage: ["custom/lcov.info"] }));
    await writeRepoFile(repoRoot, "custom/lcov.info", lcov("src/app.ts", [2], 1));

    const loaded = await loadCoverage(repoRoot, [fileChange("src/app.ts")]);

    expect(loaded.coverage?.artifactPath.replace(/\\/g, "/")).toContain("custom/lcov.info");
  });

  it("ignores coverage paths that do not match changed files", async () => {
    const repoRoot = await tempRepo();
    await writeRepoFile(repoRoot, "src/app.ts", "const existing = true;\nconst uncovered = 1;\n");
    await writeRepoFile(repoRoot, "coverage/lcov.info", lcov("src/other.ts", [2], 1));

    const loaded = await loadCoverage(repoRoot, [fileChange("src/app.ts")]);
    const model = analyzeDiff({
      repoRoot,
      diffSpec: "WORKTREE",
      git: { headSha: "abc", branch: "main" },
      coverage: loaded.coverage,
      patch: patchFor("src/app.ts", ["const uncovered = 1;"])
    });

    expect(model.hunks[0]?.coverage).toBeUndefined();
  });

  it("exposes standalone parsers for lcov and cobertura fixtures", async () => {
    const repoRoot = await tempRepo();
    expect(parseLcov(lcov("src/app.ts", [2], 1), repoRoot).get("src/app.ts")?.get(2)).toBe(1);
    expect(parseCobertura(cobertura("src/app.ts", [2], 0), repoRoot).get("src/app.ts")?.get(2)).toBe(0);
  });
});

async function tempRepo(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "sift-coverage-"));
}

async function writeRepoFile(repoRoot: string, relativePath: string, text: string): Promise<string> {
  const file = path.join(repoRoot, relativePath);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text, "utf8");
  return file;
}

function fileChange(filePath: string): FileChange {
  return { path: filePath, status: "modified", hunkIds: [] };
}

function patchFor(file: string, added: string[]): string {
  return `diff --git a/${file} b/${file}
--- a/${file}
+++ b/${file}
@@ -1 +1,${added.length + 1} @@
 const existing = true;
${added.map((line) => `+${line}`).join("\n")}
`;
}

function lcov(file: string, lines: number[], hits: number): string {
  return `TN:
SF:${file}
${lines.map((line) => `DA:${line},${hits}`).join("\n")}
end_of_record
`;
}

function cobertura(file: string, lines: number[], hits: number): string {
  return `<coverage>
  <packages>
    <package name="src">
      <classes>
        <class filename="${file}">
          <lines>
            ${lines.map((line) => `<line number="${line}" hits="${hits}" />`).join("\n")}
          </lines>
        </class>
      </classes>
    </package>
  </packages>
</coverage>`;
}
