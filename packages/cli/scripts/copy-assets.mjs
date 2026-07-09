import { createRequire } from "node:module";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const require = createRequire(path.join(repoRoot, "packages", "core", "package.json"));
const distDir = path.join(packageRoot, "dist");
const webSource = path.join(repoRoot, "packages", "web", "dist");
const webTarget = path.join(distDir, "web");
const grammarTarget = path.join(distDir, "grammars");
const wasmRoot = path.join(path.dirname(require.resolve("tree-sitter-wasms/package.json")), "out");
const grammars = [
  "tree-sitter-typescript.wasm",
  "tree-sitter-tsx.wasm",
  "tree-sitter-javascript.wasm",
  "tree-sitter-python.wasm",
  "tree-sitter-go.wasm"
];

await fs.rm(webTarget, { recursive: true, force: true });
await fs.cp(webSource, webTarget, { recursive: true });
await fs.mkdir(grammarTarget, { recursive: true });

for (const grammar of grammars) {
  await fs.copyFile(path.join(wasmRoot, grammar), path.join(grammarTarget, grammar));
}
