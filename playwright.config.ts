import { defineConfig } from "@playwright/test";

const demoHome = `${process.cwd().replace(/\\/gu, "/")}/.demo/home`;

export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: "http://127.0.0.1:4173", trace: "retain-on-failure" },
  webServer: {
    command: "pnpm demo -- --headless && cd .demo/repo && node ../../packages/cli/dist/index.js --no-open --port 4173",
    env: {
      ...process.env,
      SIFT_HOME: `${demoHome}/.sift`,
      SIFT_CLAUDE_DIR: `${demoHome}/.claude`
    },
    url: "http://127.0.0.1:4173/api/review",
    reuseExistingServer: false,
    timeout: 60_000
  }
});
