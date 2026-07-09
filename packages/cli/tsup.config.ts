import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  platform: "node",
  dts: false,
  clean: true,
  splitting: false,
  sourcemap: false,
  external: ["fast-xml-parser", "tree-sitter-wasms", "web-tree-sitter", "yaml"],
  noExternal: [/^@sift-review\//]
});
