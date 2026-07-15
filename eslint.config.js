import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/dist-types/**",
      "eslint.config.js",
      "**/coverage/**",
      ".demo/**",
      ".sift/**",
      ".evalcache/**",
      "packages/eval/report/**",
      "node_modules/**",
      "pnpm-lock.yaml",
      "scripts/**",
      "packages/cli/scripts/**"
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: {
        Buffer: "readonly",
        console: "readonly",
        process: "readonly",
        URL: "readonly"
      },
      parserOptions: {
        projectService: {
          allowDefaultProject: [
            "*.js",
            "knip.ts",
            "playwright.config.ts",
            "e2e/*.ts",
            "vitest.config.ts",
            "packages/web/vite.config.ts",
            "packages/cli/tsup.config.ts"
          ]
        },
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/unbound-method": "off"
    }
  }
);
