import { describe, expect, it } from "vitest";
import { doctorJson, inspectDoctor, renderDoctor } from "./doctor.js";

function healthyDoctor() {
  return inspectDoctor({
    cwd: "C:/repo",
    env: { COLORTERM: "truecolor" },
    platform: "win32",
    nodeVersion: "22.13.4",
    version: "1.0.0",
    run: (bin, args) =>
      Promise.resolve(
        bin === "git"
          ? { code: 0, stdout: "git version 2.45.0\n", stderr: "" }
          : args[0] === "auth"
            ? { code: 0, stdout: "", stderr: "" }
            : { code: 0, stdout: "gh version 2.70.0\n", stderr: "" }
      ),
    discoverRepo: () => Promise.resolve("C:/repo"),
    hooks: (_repoRoot, project) => Promise.resolve(!project),
    coverage: () => Promise.resolve("C:/repo/coverage/lcov.info"),
    editor: () => Promise.resolve("code"),
    mcp: () => Promise.resolve({ readable: true, registered: true, path: ".claude.json" }),
    readFile: () => Promise.resolve("first\nsecond\n"),
    provenancePath: () => "provenance.jsonl"
  });
}

describe("sift doctor", () => {
  it("renders a stable human report from injectable machine facts", async () => {
    expect(renderDoctor(await healthyDoctor())).toMatchInlineSnapshot(`
"Sift doctor (v1.0.0)
✓ Node >=22.13: 22.13.4
✓ Git: git version 2.45.0
✓ Repository: inside a Git repository
✓ GitHub CLI: gh version 2.70.0
✓ GitHub authentication: authenticated
✓ Claude Code hooks: user installed; project missing
✓ Provenance log: 2 entries
✓ Coverage artifact: coverage/lcov.info
✓ Editor: code
✓ MCP registration: registered
✓ Terminal truecolor: available
✓ Sift: v1.0.0; update hint: check npm when published"
`);
  });

  it("keeps gh installation and authentication as separate machine-readable states", async () => {
    const report = await inspectDoctor({
      cwd: "repo",
      env: {},
      platform: "win32",
      nodeVersion: "20.0.0",
      version: "1.0.0",
      run: (bin) => Promise.resolve(bin === "git" ? { code: 0, stdout: "git version 2\n", stderr: "" } : { code: 127, stdout: "", stderr: "" }),
      discoverRepo: () => Promise.resolve("repo"),
      hooks: () => Promise.resolve(false),
      coverage: () => Promise.resolve(undefined),
      editor: () => Promise.resolve(undefined),
      mcp: () => Promise.resolve({ readable: false, registered: false }),
      readFile: () => Promise.reject(new Error("missing")),
      provenancePath: () => "missing.jsonl"
    });
    const payload = JSON.parse(doctorJson(report)) as { checks: Array<{ id: string; state: string }> };
    expect(payload.checks).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "gh", state: "warn" }), expect.objectContaining({ id: "gh-auth", state: "warn" })])
    );
    expect(renderDoctor(report)).toContain("Fix: winget install --id GitHub.cli");
    expect(renderDoctor(report)).toContain("Fix: claude mcp add sift -- sift mcp");
  });
});
