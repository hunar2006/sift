import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { keymapEntries } from "../packages/core/src/keymap.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readme = path.join(root, "README.md");
const start = "<!-- keymap:start -->";
const end = "<!-- keymap:end -->";

const table = [
  start,
  "| Key | Action |",
  "|---|---|",
  ...keymapEntries("web").map((entry) => `| \`${entry.key}\` | ${entry.label} |`),
  end
].join("\n");
const source = await fs.readFile(readme, "utf8");
const marker = new RegExp(`${escape(start)}[\\s\\S]*?${escape(end)}`, "u");
if (!marker.test(source)) {
  throw new Error("README keymap markers are missing.");
}
const next = source.replace(marker, table);
if (process.argv.includes("--check")) {
  if (next !== source) {
    throw new Error("README keymap table is stale. Run pnpm keymap:readme.");
  }
  console.log("README keymap table matches the registry.");
} else {
  await fs.writeFile(readme, next, "utf8");
  console.log("README keymap table generated.");
}

function escape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
