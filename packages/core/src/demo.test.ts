import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createDemoRepo } from "./demo.js";

describe("demo repository generator", () => {
  it("creates a git-backed demo repo with isolated provenance fixtures", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "sift-demo-test-"));
    try {
      const demo = await createDemoRepo({ rootDir });
      const packageJson = JSON.parse(await fs.readFile(path.join(demo.repoRoot, "package.json"), "utf8")) as {
        dependencies: Record<string, string>;
      };
      const provenance = await fs.readFile(path.join(demo.siftHome, "provenance.jsonl"), "utf8");
      const rules = await fs.readFile(path.join(demo.repoRoot, ".sift", "rules.yml"), "utf8");
      const coverage = await fs.readFile(path.join(demo.repoRoot, "coverage", "lcov.info"), "utf8");

      await expect(fs.stat(path.join(demo.repoRoot, ".git"))).resolves.toBeTruthy();
      await expect(fs.stat(path.join(demo.repoRoot, "migrations", "002_drop_legacy.sql"))).resolves.toBeTruthy();
      expect(packageJson.dependencies).toHaveProperty("jsonwebtoken");
      expect(packageJson.dependencies).toHaveProperty("lodahs");
      expect(rules).toContain("BAN_LEGACY_AUTH");
      expect(coverage).toContain("SF:src/coverage/covered.ts");
      expect(provenance).toContain('"source":"claude-code"');
      expect(demo.env).toMatchObject({
        SIFT_HOME: demo.siftHome,
        SIFT_CLAUDE_DIR: demo.claudeDir
      });
    } finally {
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });
});
