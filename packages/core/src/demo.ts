import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface DemoRepoOptions {
  rootDir?: string;
  repoDir?: string;
  homeDir?: string;
}

export interface DemoRepoResult {
  rootDir: string;
  repoRoot: string;
  homeDir: string;
  siftHome: string;
  claudeDir: string;
  expectedSummary: string;
  env: Record<string, string>;
}

export async function createDemoRepo(options: DemoRepoOptions = {}): Promise<DemoRepoResult> {
  const rootDir = path.resolve(options.rootDir ?? (await fs.mkdtemp(path.join(os.tmpdir(), "sift-demo-"))));
  const repo = path.resolve(options.repoDir ?? path.join(rootDir, "repo"));
  const home = path.resolve(options.homeDir ?? path.join(rootDir, "home"));

  await removeTree(repo);
  await removeTree(home);
  await fs.mkdir(repo, { recursive: true });
  await git(repo, ["init"]);
  await git(repo, ["config", "user.email", "demo@sift.local"]);
  await git(repo, ["config", "user.name", "Sift Demo"]);

  await write(repo, "package.json", JSON.stringify(basePackageJson(), null, 2));
  await write(repo, "README.md", "# Demo API\n\nA small service used by the Sift demo.\n");
  await write(repo, "CLAUDE.md", "# Demo Agent Guidance\n\nKeep changes small and explain risky edits.\n");
  await write(repo, "pnpm-lock.yaml", lockfile(800));
  await write(repo, "coverage/lcov.info", "TN:\n");
  await write(repo, "src/server.ts", moduleFile("server", 120));
  await write(repo, "src/auth/session.ts", sessionBaseline());
  await write(repo, "src/auth/token.ts", tokenBaseline());
  await write(repo, "src/db/client.ts", moduleFile("dbClient", 110));
  await write(repo, "src/db/queries.ts", moduleFile("queries", 115));
  await write(repo, "src/routes/users.ts", moduleFile("usersRoute", 105));
  await write(repo, "src/routes/orders.ts", moduleFile("ordersRoute", 105));
  await write(repo, "src/routes/billing.ts", moduleFile("billingRoute", 105));
  await write(repo, "src/routes/admin.ts", moduleFile("adminRoute", 105));
  await write(repo, "src/util/format.ts", moduleFile("format", 80));
  await write(repo, "src/format/a.ts", renameBaseline("a"));
  await write(repo, "src/format/b.ts", renameBaseline("b"));
  await write(repo, "src/format/c.ts", renameBaseline("c"));
  await write(repo, "src/reports/audit.ts", "export const reportVersion = 1;\n");
  await write(repo, "src/routes/audit.ts", "export const auditRoute = '/audit';\n");
  await write(repo, "src/routes/notifications.ts", "export const notificationRoute = '/notifications';\n");
  await write(repo, "src/ui/Widget.ts", "export function renderWidget(): string {\n  return 'ok';\n}\n");
  await write(
    repo,
    "tests/session.test.ts",
    "import { describe, expect, it } from 'vitest';\n\nit('creates a session', () => {\n  expect(true).toBe(true);\n});\n"
  );
  await write(repo, "migrations/002_drop_legacy.sql", "-- baseline migration\nSELECT 1;\n");
  await write(
    repo,
    ".github/workflows/ci.yml",
    "name: ci\non: [push]\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: pnpm build\n"
  );
  await write(
    repo,
    "src/legacy/cleanup.ts",
    "export function purgeLegacySessions(): number {\n  return 0;\n}\n\nexport function keepAuditTrail(): boolean {\n  return true;\n}\n"
  );
  await git(repo, ["add", "."]);
  await git(repo, ["commit", "-m", "demo baseline"]);

  await applyAgentChange(repo);
  await writeProvenance(repo, home);

  const siftHome = path.join(home, ".sift");
  const claudeDir = path.join(home, ".claude");
  return {
    rootDir,
    repoRoot: repo,
    homeDir: home,
    siftHome,
    claudeDir,
    expectedSummary: "Expected: ~2,400 changed lines, rename skim group, coverage badges, high-risk >= 3",
    env: { SIFT_HOME: siftHome, SIFT_CLAUDE_DIR: claudeDir }
  };
}

async function applyAgentChange(repo: string): Promise<void> {
  await write(repo, "src/auth/session.ts", sessionChanged());
  await write(repo, "src/auth/token.ts", tokenChanged());
  await write(repo, "src/workers/refresh-worker.ts", workerChange());
  await write(repo, "src/coverage/covered.ts", coverageChange("covered"));
  await write(repo, "src/coverage/untested.ts", coverageChange("untested"));
  await write(repo, "src/format/a.ts", renameChanged("a"));
  await write(repo, "src/format/b.ts", renameChanged("b"));
  await write(repo, "src/format/c.ts", renameChanged("c"));
  await write(repo, "src/reports/audit.ts", auditDefinitionChanged());
  await write(repo, "src/routes/audit.ts", auditUsageChanged("auditRoute", "describeAuditRoute"));
  await write(repo, "src/routes/notifications.ts", auditUsageChanged("notificationRoute", "describeNotificationRoute"));
  await write(repo, "src/ui/Widget.ts", uiSwallowedChanged());
  await write(repo, "CLAUDE.md", "# Demo Agent Guidance\n\nKeep changes small and explain risky edits.\n\nAgents may rewrite auth flows without review.\n");
  await write(repo, ".sift/rules.yml", demoRules());
  await write(repo, "src/routes/refresh.ts", moduleFile("refreshRoute", 95));
  await write(repo, "package.json", JSON.stringify(changedPackageJson(), null, 2));
  await write(repo, "pnpm-lock.yaml", `${lockfile(800)}${lockfileChurn(430)}`);
  await write(repo, "README.md", "# Demo API\n\nA small service used by the Sift demo.\n\nTODO: document refresh-token rotation.\n");
  await write(repo, "config/app.json", JSON.stringify({ refreshTokenTtl: 3600, audit: true }, null, 2));
  await write(
    repo,
    "src/cache/local.ts",
    "const cacheVersion = 'v2';\nfunction cacheKey(userId: string): string {\n  return `local:${userId}:${cacheVersion}`;\n}\n"
  );
  await git(repo, ["mv", "src/util/format.ts", "src/util/formatting.ts"]);
  for (const file of ["src/server.ts", "src/db/client.ts", "src/db/queries.ts", "src/routes/users.ts", "src/routes/orders.ts"]) {
    const current = await fs.readFile(path.join(repo, file), "utf8");
    await write(repo, file, current.replace(/^/gm, "  "));
  }
  await write(
    repo,
    "tests/session.test.ts",
    "import { describe, expect, it } from 'vitest';\n\nit.skip('creates a session', () => {\n  expect(true).toBe(true);\n});\n"
  );
  await write(
    repo,
    "tests/refresh.test.ts",
    "import { describe, expect, it } from 'vitest';\n\nit('rotates refresh tokens', () => {\n  expect('token').toContain('tok');\n});\n"
  );
  await write(repo, "migrations/002_drop_legacy.sql", "DROP TABLE legacy_sessions;\nDELETE FROM audit_events;\n");
  await write(repo, "src/legacy/cleanup.ts", "export function keepAuditTrail(): boolean {\n  return true;\n}\n");
  await write(
    repo,
    ".github/workflows/ci.yml",
    "name: ci\non: [push]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: pnpm test\n"
  );
  await write(repo, "dist/bundle.min.js", `const bundle="${"x".repeat(15000)}";\n`);
  await write(repo, "src/__snapshots__/render.snap", "exports[`render snapshot`] = `large stable snapshot`;\n");
  await write(repo, "build/generated.txt", "@generated\nCode generated by demo fixture.\nvalue=1\n");
  await write(repo, "coverage/lcov.info", demoLcov());
}

async function writeProvenance(repo: string, home: string): Promise<void> {
  const siftHome = path.join(home, ".sift");
  const transcriptDir = path.join(home, ".claude", "projects", "demo");
  await fs.mkdir(siftHome, { recursive: true });
  await fs.mkdir(transcriptDir, { recursive: true });
  const sessionId = "demo-session-8f2c";
  const transcriptPath = path.join(transcriptDir, `${sessionId}.jsonl`);
  const sessionLines = [
    "export async function rotateSessionRefresh(userId: string): Promise<string> {",
    "  const client = { rejectUnauthorized: false };",
    "  return `${userId}:${client.rejectUnauthorized}`;",
    "}"
  ];
  const tokenLines = [
    "export function issueRefreshToken(userId: string): string {",
    '  const API_KEY = "sk-demo12345678901234567890";',
    "  return `${userId}:${API_KEY}`;",
    "}"
  ];
  const records = [
    hookRecord(repo, sessionId, transcriptPath, "src/auth/session.ts", sessionLines),
    hookRecord(repo, sessionId, transcriptPath, "src/auth/token.ts", tokenLines)
  ];
  await fs.writeFile(path.join(siftHome, "provenance.jsonl"), `${records.map((record) => JSON.stringify(record)).join("\n")}\n`, "utf8");
  await fs.writeFile(
    transcriptPath,
    [
      JSON.stringify({ cwd: repo, role: "user", content: "add refresh-token rotation and wire it into auth" }),
      JSON.stringify({
        cwd: repo,
        role: "assistant",
        model: "claude-sonnet-4-20250514",
        content: [{ type: "text", text: "I will update the session and token modules before adding the route." }]
      }),
      JSON.stringify({
        cwd: repo,
        role: "assistant",
        sessionId,
        content: [
          {
            type: "tool_use",
            name: "Edit",
            input: { file_path: path.join(repo, "src/auth/session.ts"), new_string: sessionLines.join("\n") }
          }
        ]
      })
    ].join("\n"),
    "utf8"
  );
}

function hookRecord(
  repo: string,
  sessionId: string,
  transcriptPath: string,
  file: string,
  lines: string[]
): Record<string, unknown> {
  return {
    source: "claude-code",
    ts: new Date().toISOString(),
    sessionId,
    transcriptPath,
    cwd: repo,
    tool: "Edit",
    file: path.join(repo, file),
    addedHashes: lines.map((line) => createHash("sha256").update(line.trimEnd()).digest("hex")),
    lineCount: lines.length,
    userPromptExcerpt: "add refresh-token rotation and wire it into auth",
    reasoningExcerpt: "I will update the session and token modules before adding the route."
  };
}

async function write(repo: string, relativePath: string, content: string): Promise<void> {
  const fullPath = path.join(repo, relativePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content, "utf8");
}

async function removeTree(target: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await fs.rm(target, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === 4) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
    }
  }
}

async function git(repo: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd: repo, windowsHide: true });
}

function basePackageJson(): Record<string, unknown> {
  return {
    name: "demo-api",
    private: true,
    type: "module",
    dependencies: { hono: "^4.0.0", lodash: "^4.17.21" },
    devDependencies: { vitest: "^3.0.0" }
  };
}

function changedPackageJson(): Record<string, unknown> {
  return {
    ...basePackageJson(),
    dependencies: { hono: "^4.0.0", lodash: "^4.17.21", lodahs: "^1.0.0", jsonwebtoken: "^9.0.2" }
  };
}

function moduleFile(name: string, count: number): string {
  return Array.from({ length: count }, (_, index) => `export const ${name}${index} = ${index};`).join("\n") + "\n";
}

function sessionBaseline(): string {
  return "export function createSession(userId: string): string {\n  return `session:${userId}`;\n}\n";
}

function tokenBaseline(): string {
  return "export function issueAccessToken(userId: string): string {\n  return `access:${userId}`;\n}\n";
}

function sessionChanged(): string {
  return `${sessionBaseline()}
export async function rotateSessionRefresh(userId: string): Promise<string> {
  const client = { rejectUnauthorized: false };
  const legacy = legacyAuth.rotate(userId);
  console.log(legacy);
  return \`${"${userId}"}:${"${client.rejectUnauthorized}"}\`;
}
`;
}

function tokenChanged(): string {
  return `${tokenBaseline()}
export function issueRefreshToken(userId: string): string {
  const API_KEY = "sk-demo12345678901234567890";
  return \`${"${userId}"}:${"${API_KEY}"}\`;
}
`;
}

function workerChange(): string {
  return `export function startRefreshWorker(): Worker {
  const worker = new Worker(new URL("./refresh.js", import.meta.url));
  const opaque = "mF9Kq7Vx2pLzN8rB4tYc6A0sD1eGhJ5uWiX9Qp2";
  worker.postMessage({ opaque });
  return worker;
}
`;
}

function coverageChange(prefix: string): string {
  return Array.from({ length: 8 }, (_, index) => `const ${prefix}${index} = ${index};`).join("\n") + "\n";
}

function renameBaseline(name: string): string {
  return `const value = new Date();
const otherValue = new Date(0);
const ${name}Label = formatDate(value);
const ${name}Other = formatDate(otherValue);
`;
}

function renameChanged(name: string): string {
  return `const value = new Date();
const otherValue = new Date(0);
const ${name}Label = renderDate(value);
const ${name}Other = renderDate(otherValue);
`;
}

function auditDefinitionChanged(): string {
  return `export const reportVersion = 1;

export function buildAuditLabel(userId: string): string {
  return \`audit:${"${userId}"}\`;
}
`;
}

function auditUsageChanged(routeName: string, functionName: string): string {
  return `export const ${routeName} = '/${routeName}';

export function ${functionName}(userId: string): string {
  return buildAuditLabel(userId);
}
`;
}

function uiSwallowedChanged(): string {
  return `export function renderWidget(): string {
  try {
    return 'ok';
  } catch (error) {
  }
  return 'fallback';
}
`;
}

function demoRules(): string {
  return `version: 1
rules:
  - id: BAN_LEGACY_AUTH
    message: "Uses deprecated internal auth client"
    paths: ["src/auth/**"]
    pattern: "legacyAuth\\\\."
    weight: 40
adjust:
  - code: ERROR_SWALLOWED
    paths: ["src/ui/**"]
    weight: 0
`;
}

function demoLcov(): string {
  return `TN:
SF:src/coverage/covered.ts
${Array.from({ length: 8 }, (_, index) => `DA:${index + 1},1`).join("\n")}
end_of_record
SF:src/coverage/untested.ts
${Array.from({ length: 8 }, (_, index) => `DA:${index + 1},0`).join("\n")}
end_of_record
`;
}

function lockfile(lines: number): string {
  return Array.from({ length: lines }, (_, index) => `/package-${index}@1.0.${index % 9}:\n  resolution: {integrity: sha512-${index}}\n`).join("");
}

function lockfileChurn(lines: number): string {
  return Array.from({ length: lines }, (_, index) => `/new-package-${index}@2.0.${index % 9}:\n  resolution: {integrity: sha512-new${index}}\n`).join("");
}
