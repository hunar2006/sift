import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { bannedProductWords } from "../packages/cli/src/copy-lint.js";

const productCopyFiles = [
  "README.md",
  "CONTRIBUTING.md",
  "docs/TROUBLESHOOTING.md",
  "packages/cli/src/index.ts",
  "packages/cli/src/init.ts",
  "packages/web/src/App.tsx",
  "packages/web/src/copy.ts",
  "packages/web/src/panels.tsx"
];

const violations = await Promise.all(
  productCopyFiles.map(async (file) => ({ file, words: bannedProductWords(await readFile(resolve(file), "utf8")) }))
);
const failures = violations.filter((violation) => violation.words.length > 0);

if (failures.length > 0) {
  throw new Error(`Banned product copy: ${failures.map(({ file, words }) => `${file} (${words.join(", ")})`).join(", ")}`);
}

console.log("Product copy check passed.");
