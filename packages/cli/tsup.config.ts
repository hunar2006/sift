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
  esbuildOptions(options) {
    options.jsx = "automatic";
  },
  external: ["fast-xml-parser", "tree-sitter-wasms", "web-tree-sitter", "yaml", "ink", "react", "react-reconciler"],
  noExternal: [/^@sift-review\//]
});
