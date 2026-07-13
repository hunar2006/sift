/**
 * The health gate checks dead files and manifest dependencies. Export reachability
 * is intentionally excluded: package entry points are public API and are already
 * covered by their package and consumer tests.
 */
export default {
  include: ["files", "dependencies", "unlisted"],
  // Vite loads its config and React transform plugin from its own process,
  // rather than through a source-file import Knip can follow.
  ignoreDependencies: ["vite", "@vitejs/plugin-react"],
  ignoreIssues: {
    // Preflight resolves zod from the owning workspace at runtime to keep the
    // root manifest runtime-free; its conformance test exercises this path.
    "scripts/preflight/stages.ts": ["unlisted"]
  },
  workspaces: {
    "packages/cli": {
      // tsup deliberately leaves these core runtime modules external so the
      // packed CLI can load parser and coverage support at runtime.
      ignoreDependencies: ["fast-xml-parser", "web-tree-sitter", "yaml"]
    }
  }
};
