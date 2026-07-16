import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const docs = ["README.md", "docs/TROUBLESHOOTING.md", "docs/GETTING-STARTED.md", "site/index.html"];
const tsx = process.platform === "win32" ? "tsx.cmd" : "tsx";

const rootHelp = await help();
const commands = new Set(["sift", ...commandNames(rootHelp)]);
const flags = new Set(flagNames(rootHelp));
for (const command of commands) {
  if (command !== "sift") {
    flagNames(await help(command)).forEach((flag) => flags.add(flag));
  }
}

const documentedCommands = new Map<string, Set<string>>();
const documentedFlags = new Map<string, Set<string>>();
for (const document of docs) {
  const source = await fs.readFile(path.join(root, document), "utf8");
  const snippets = source.match(/(?<![A-Za-z0-9_./:-])sift\b(?:[ \t]+[^\n`<]*)?/gu) ?? [];
  const commandsHere = new Set<string>();
  const flagsHere = new Set<string>();
  for (const snippet of snippets) {
    const [command] = snippet.match(/^sift\s+([a-z][\w-]*)/u)?.slice(1) ?? [];
    if (command) commandsHere.add(command);
    for (const flag of flagNames(snippet)) flagsHere.add(flag);
  }
  documentedCommands.set(document, commandsHere);
  documentedFlags.set(document, flagsHere);
}

const documented = new Set([...documentedCommands.values()].flatMap((items) => [...items]));
const usedFlags = new Set([...documentedFlags.values()].flatMap((items) => [...items]));
for (const document of docs) {
  const source = await fs.readFile(path.join(root, document), "utf8");
  const snippets = source.match(/(?<![A-Za-z0-9_./:-])sift\b(?:[ \t]+[^\n`<]*)?/gu) ?? [];
  for (const snippet of snippets) {
    const [, parent, child] = snippet.match(/^sift\s+([a-z][\w-]*)(?:\s+([a-z][\w-]*))?/u) ?? [];
    if (parent && child && commands.has(parent)) {
      flagNames(await help(parent, child)).forEach((flag) => flags.add(flag));
    }
  }
}
const failures = [
  ...[...documented].filter((command) => !commands.has(command)).map((command) => `unknown documented command: sift ${command}`),
  ...[...commands].filter((command) => command !== "sift" && !documented.has(command)).map((command) => `undocumented command: sift ${command}`),
  ...[...usedFlags].filter((flag) => !flags.has(flag)).map((flag) => `unknown documented flag: ${flag}`)
];

if (failures.length) {
  throw new Error(`Documentation and --help disagree:\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
}

console.log(`docs check passed (${commands.size - 1} commands, ${flags.size} flags).`);

function commandNames(output: string): string[] {
  const commandsSection = output.split(/\nCommands:\s*\n/u)[1] ?? "";
  return [...commandsSection.matchAll(/^\s{2}([a-z][\w-]*)\b/gmu)].map((match) => match[1]!);
}

function flagNames(output: string): string[] {
  return [...output.matchAll(/--[a-z][\w-]*/gu)].map((match) => match[0]!);
}

function help(...commands: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(tsx, ["packages/cli/src/index.ts", ...commands, "--help"], {
      cwd: root,
      shell: process.platform === "win32",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk));
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`sift ${commands.join(" ")} --help exited ${code ?? "null"}: ${stderr}`));
    });
  });
}
