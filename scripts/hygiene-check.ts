import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

type Finding = { file: string; line: number; label: string };

const trackedFiles = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);
const canonicalReferences = canonicalOriginReferences();
const patterns = [
  { label: "Windows profile path", expression: new RegExp(["C:", "Users"].join(String.raw`\\`), "iu") },
  { label: "Windows profile path", expression: new RegExp(["C:", "Users"].join("/"), "iu") },
  { label: "macOS profile path", expression: new RegExp(["/", "Users", "/"].join(""), "u") },
  { label: "Linux profile path", expression: new RegExp(["/", "home", "/"].join(""), "u") },
  { label: "checkout path", expression: new RegExp(["Downloads", "sift"].join(String.raw`\\`), "iu") },
  { label: "checkout path", expression: new RegExp(["Downloads", "sift"].join("/"), "iu") },
  { label: "personal handle", expression: new RegExp(["hun", "ar"].join(""), "iu") },
  { label: "email address", expression: /[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)*\.[A-Z]{2,}/iu }
];
const requiredIgnored = ["PREFLIGHT.md", "PREFLIGHT.json", "qa/", "test-results/", ".demo/", ".evalcache/", "preflight-artifacts/"];

const findings: Finding[] = [];
const presentFiles: string[] = [];
for (const file of trackedFiles) {
  let bytes: Buffer;
  try {
    bytes = await readFile(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      continue;
    }
    throw error;
  }
  presentFiles.push(file);
  if (bytes.includes(0)) {
    continue;
  }
  const lines = bytes.toString("utf8").split(/\r?\n/u);
  for (const [offset, line] of lines.entries()) {
    for (const { label, expression } of patterns) {
      const matches = line.matchAll(new RegExp(expression.source, `${expression.flags}g`));
      for (const match of matches) {
        if (allowedMatch(file, line, match.index ?? 0, match[0].length, label, match[0])) {
          continue;
        }
        findings.push({ file, line: offset + 1, label });
      }
    }
  }
}

const ignoreLines = new Set((await readFile(".gitignore", "utf8")).split(/\r?\n/u).map((line) => line.trim()));
const missingIgnores = requiredIgnored.filter((entry) => !ignoreLines.has(entry));
const trackedArtifacts = presentFiles.filter((file) => requiredIgnored.some((entry) => (entry.endsWith("/") ? file.startsWith(entry) : file === entry)));
const license = await readFile("LICENSE", "utf8");
const notice = await readFile("NOTICE", "utf8");

if (!license.includes("Apache License") || !notice.match(/^Sift\r?\nCopyright \d{4} .+\r?\n?$/u)) {
  findings.push({ file: "LICENSE/NOTICE", line: 1, label: "Apache-2.0 attribution" });
}
if (missingIgnores.length > 0) {
  findings.push({ file: ".gitignore", line: 1, label: `missing artifact ignore: ${missingIgnores.join(", ")}` });
}
for (const file of trackedArtifacts) {
  findings.push({ file, line: 1, label: "generated artifact must not be tracked" });
}

if (findings.length > 0) {
  throw new Error(`Public hygiene check failed:\n${findings.map((finding) => `- ${finding.file}:${finding.line} ${finding.label}`).join("\n")}`);
}

console.log(`public hygiene check passed (${presentFiles.length} tracked files; canonical origin and NOTICE attribution are the only handle exceptions).`);

function canonicalOriginReferences(): string[] {
  const origin = execFileSync("git", ["remote", "get-url", "origin"], { encoding: "utf8" }).trim();
  const match = origin.match(/github\.com[/:]([^/:\s]+)\/([^/\s]+)$/u);
  if (!match) {
    throw new Error("Public hygiene check requires a GitHub origin remote to verify canonical repository links.");
  }
  const [, owner, rawRepo] = match;
  const repo = rawRepo.replace(/\.git$/u, "");
  return [
    `https://github.com/${owner}/${repo}`,
    `git+https://github.com/${owner}/${repo}`,
    `https://raw.githubusercontent.com/${owner}/${repo}`
  ];
}

function allowedMatch(file: string, line: string, index: number, length: number, label: string, value: string): boolean {
  if (label === "email address") {
    if (file === "pnpm-lock.yaml") {
      return true;
    }
    const domain = value.slice(value.lastIndexOf("@") + 1).toLowerCase();
    return domain === "example.com" || domain.endsWith(".test") || domain.endsWith(".local") || domain.endsWith(".invalid");
  }
  if (label !== "personal handle") {
    return false;
  }
  if (file === "NOTICE" && /^Copyright \d{4} .+$/u.test(line)) {
    return true;
  }
  return canonicalReferences.some((reference) => {
    for (let start = line.indexOf(reference); start >= 0; start = line.indexOf(reference, start + reference.length)) {
      if (index >= start && index + length <= start + reference.length) {
        return true;
      }
    }
    return false;
  });
}
