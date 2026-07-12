import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "packages/*/src/**/*.test.tsx", "scripts/preflight/**/*.test.ts"],
    exclude: ["node_modules/**", ".demo/**", "**/dist/**", "**/dist-types/**"],
    coverage: {
      provider: "v8",
      include: ["packages/core/src/**/*.ts", "packages/claude-adapter/src/**/*.ts", "packages/web/src/**/*.ts"],
      exclude: ["**/*.test.ts", "**/*.test.tsx", "**/index.ts", "**/types.ts"]
    }
  }
});
