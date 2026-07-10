import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const demoRoot = path.join(root, ".demo");
const demoRepo = path.join(demoRoot, "repo");
const shotsDir = path.join(root, "docs", "screenshots");
const cli = path.join(root, "packages", "cli", "dist", "index.js");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

await run(pnpm, ["build"], root);
await run(pnpm, ["demo", "--", "--headless"], root);
await fs.mkdir(shotsDir, { recursive: true });

const child = spawn(process.execPath, [cli, "--no-open", "--port", "4311"], {
  cwd: demoRepo,
  env: {
    ...process.env,
    SIFT_HOME: path.join(demoRoot, "home", ".sift"),
    SIFT_CLAUDE_DIR: path.join(demoRoot, "home", ".claude")
  },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true
});

try {
  const url = await serverUrl(child);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.locator(".shell").waitFor({ state: "visible" });
    const helpClose = page.locator(".help button");
    if (await helpClose.count()) {
      await helpClose.click();
    }
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(shotsDir, "workbench-dark.png") });

    await page.keyboard.press("T");
    await page.screenshot({ path: path.join(shotsDir, "workbench-light.png") });

    await page.keyboard.press("T");
    await page.keyboard.press("f");
    await page.locator(".focus-card").waitFor({ state: "visible" });
    await page.screenshot({ path: path.join(shotsDir, "focus.png") });
    await page.locator(".focus-exit").click();
    await page.locator(".focus-card").waitFor({ state: "hidden" });

    const timelineButton = page.getByRole("button", { name: "Timeline", exact: true });
    await timelineButton.click();
    await page.locator(".timeline-panel").waitFor({ state: "visible" });
    await page.screenshot({ path: path.join(shotsDir, "timeline.png") });
    await page.locator(".timeline-panel").getByRole("button", { name: "Close", exact: true }).click();

    const model = (await fetch(`${url}/api/review`).then((response) => response.json())) as {
      groups: Array<{ kind: string; hunkIds: string[] }>;
    };
    const attentionIds = model.groups.filter((group) => group.kind === "attention").flatMap((group) => group.hunkIds);
    for (const id of attentionIds) {
      const response = await fetch(`${url}/api/hunks/${encodeURIComponent(id)}/status`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "approved" })
      });
      if (!response.ok) {
        throw new Error(`Could not approve demo hunk ${id}.`);
      }
    }
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator(".completion").waitFor({ state: "visible" });
    await page.screenshot({ path: path.join(shotsDir, "completion.png") });
  } finally {
    await browser.close();
  }
} finally {
  child.kill();
}

console.log(`screenshots written to ${shotsDir}`);

function run(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit",
      windowsHide: true,
      shell: process.platform === "win32"
    });
    child.once("error", reject);
    child.once("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited ${code ?? "null"}.`))));
  });
}

function serverUrl(process: ReturnType<typeof spawn>): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for the local Sift server.")), 20_000);
    const onData = (chunk: Buffer) => {
      const match = chunk.toString().match(/http:\/\/127\.0\.0\.1:\d+/u);
      if (match?.[0]) {
        clearTimeout(timeout);
        resolve(match[0]);
      }
    };
    process.stdout?.on("data", onData);
    process.stderr?.on("data", onData);
    process.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    process.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Sift server exited ${code ?? "null"} before it was ready.`));
    });
  });
}
