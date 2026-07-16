import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { installPrePushGate, prePushBlock, PRE_PUSH_START, removePrePushGate, runSetup, stripPrePushBlock, updateSetupConfig } from "./setup.js";

const execFileAsync = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function gitRepo(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sift-setup-"));
  roots.push(root);
  await execFileAsync("git", ["init"], { cwd: root, windowsHide: true });
  return root;
}

describe("sift setup", () => {
  it("prints manual steps without a TTY and exits without mutating the repository", async () => {
    const lines = await runSetup("repo", {
      io: { input: { isTTY: false }, output: { isTTY: false } } as never
    }, { discoverRepo: () => Promise.resolve("repo") });
    expect(lines).toContain("Sift setup needs a TTY; no files were changed.");
    expect(lines).toContain("  3. claude mcp add sift -- sift mcp");
  });

  it("appends, backs up, idempotently detects, and removes only its pre-push block", async () => {
    const root = await gitRepo();
    const hook = path.join(root, ".git", "hooks", "pre-push");
    const foreign = "#!/bin/sh\necho foreign\n";
    await fs.writeFile(hook, foreign, "utf8");
    expect(await installPrePushGate(root, 40, () => 1000)).toBe("installed");
    expect(await installPrePushGate(root, 40, () => 1000)).toBe("exists");
    expect(await fs.readFile(hook, "utf8")).toContain(PRE_PUSH_START);
    expect(await fs.readFile(hook, "utf8")).toContain("echo foreign");
    expect(await fs.readFile(`${hook}.bak-sift-1`, "utf8")).toBe(foreign);

    expect(await removePrePushGate(root, () => 1000)).toBe("removed");
    const removed = await fs.readFile(hook, "utf8");
    expect(removed).toContain("echo foreign");
    expect(removed).not.toContain(PRE_PUSH_START);
    expect(await fs.readFile(`${hook}.bak-sift-1`, "utf8")).toBe(foreign);
  });

  it("keeps foreign line endings intact when removing the marked pre-push block", () => {
    const foreign = "#!/bin/sh\r\necho foreign\r\n";
    expect(stripPrePushBlock(`${foreign}${prePushBlock()}\n`)).toBe(foreign);
  });

  it("records only setup-owned config changes and restores them through --remove", async () => {
    const root = await gitRepo();
    await fs.mkdir(path.join(root, ".sift"));
    await fs.writeFile(path.join(root, ".sift", "config.json"), '{"theme":"graphite"}\n', "utf8");
    await updateSetupConfig(root, { editor: "code", flagReasons: ["Needs tests"] });

    const lines = await runSetup(root, { remove: true }, {
      uninstallHooks: () => Promise.resolve("ignored")
    });
    expect(lines).toContain("config: 2 restored");
    expect(JSON.parse(await fs.readFile(path.join(root, ".sift", "config.json"), "utf8"))).toEqual({ theme: "graphite" });
  });

  it("confirms each interactive setup item and writes only confirmed choices", async () => {
    const root = await gitRepo();
    const answers = ["y", "n", "n", "y", "", "y"];
    const lines = await runSetup(root, {
      io: { input: { isTTY: true }, output: { isTTY: true } } as never
    }, {
      prompt: () => Promise.resolve(answers.shift() ?? ""),
      installHooks: () => Promise.resolve("ignored"),
      hooksStatus: () => Promise.resolve(false),
      detectEditor: () => Promise.resolve("code"),
      detectCoverage: () => Promise.resolve(path.join(root, "coverage", "lcov.info"))
    });
    const config = JSON.parse(await fs.readFile(path.join(root, ".sift", "config.json"), "utf8")) as Record<string, unknown>;
    expect(config.editor).toBe("code");
    expect(config.coverage).toEqual(["coverage/lcov.info"]);
    expect(lines).toContain("hooks: user scope ready");
    expect(lines).toContain("pre-push gate: skipped");
    expect(lines.filter((line) => line.startsWith("Daily loop:")).length).toBe(1);
  });

  it("removes starter files only when this setup run created and left them unchanged", async () => {
    const root = await gitRepo();
    const answers = ["n", "n", ""];
    await runSetup(root, {
      io: { input: { isTTY: true }, output: { isTTY: true } } as never
    }, {
      prompt: () => Promise.resolve(answers.shift() ?? ""),
      hooksStatus: () => Promise.resolve(false),
      detectEditor: () => Promise.resolve(null),
      detectCoverage: () => Promise.resolve(undefined)
    });

    const lines = await runSetup(root, { remove: true }, { uninstallHooks: () => Promise.resolve("ignored") });
    expect(lines).toContain("config: 0 restored; 2 starters removed");
    await expect(fs.stat(path.join(root, ".sift", "config.json"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.stat(path.join(root, ".sift", "rules.yml"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not remove a Sift hook that existed before setup", async () => {
    const root = await gitRepo();
    const answers = ["y", "n", "n", ""];
    await runSetup(root, {
      io: { input: { isTTY: true }, output: { isTTY: true } } as never
    }, {
      prompt: () => Promise.resolve(answers.shift() ?? ""),
      hooksStatus: () => Promise.resolve(true),
      installHooks: () => Promise.resolve("ignored"),
      detectEditor: () => Promise.resolve(null),
      detectCoverage: () => Promise.resolve(undefined)
    });
    const removed: boolean[] = [];
    const lines = await runSetup(root, { remove: true }, {
      uninstallHooks: (_repoRoot, project) => {
        removed.push(project);
        return Promise.resolve("ignored");
      }
    });
    expect(removed).toEqual([]);
    expect(lines).toContain("hooks: no setup-owned hooks to remove");
  });
});
