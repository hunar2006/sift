import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright";

type Theme = "graphite" | "assay" | "paper";

const THEME_LABEL: Record<Theme, string> = {
  graphite: "Graphite",
  assay: "Assay",
  paper: "Paper"
};

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const demoRoot = path.join(root, ".demo");
const demoRepo = path.join(demoRoot, "repo");
const shotsDir = path.join(root, "docs", "screenshots");
const cli = path.join(root, "packages", "cli", "dist", "index.js");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const copyOnly = process.argv.includes("--copy");
const demoEnv = {
  ...process.env,
  SIFT_HOME: path.join(demoRoot, "home", ".sift"),
  SIFT_CLAUDE_DIR: path.join(demoRoot, "home", ".claude")
};

await run(pnpm, ["build"], root);
await run(pnpm, ["demo", "--", "--headless"], root);
await fs.mkdir(shotsDir, { recursive: true });
const reportPath = path.join(demoRoot, "sift-report.html");
await run(process.execPath, [cli, "report", "--html", "-o", reportPath], demoRepo, demoEnv);

const child = spawn(process.execPath, [cli, "--no-open", "--port", "4311"], {
  cwd: demoRepo,
  env: demoEnv,
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
    if (copyOnly && (await helpClose.count())) {
      await page.screenshot({ path: path.join(shotsDir, "overlay.png") });
    }
    if (await helpClose.count()) {
      await helpClose.click();
    }
    await page.waitForTimeout(400);
    if (!copyOnly) {
    // Allow lazy Shiki themes to paint before capture.
    await page.waitForFunction(() => document.querySelectorAll(".diff-body code span").length > 0, null, {
      timeout: 5000
    }).catch(() => undefined);
    await page.screenshot({ path: path.join(shotsDir, "workbench-dark.png") });

    await selectTheme(page, "assay");
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(shotsDir, "workbench-assay.png") });

    // Keep a single side-by-side artifact so Assay's ink-blue surfaces can be
    // compared directly with Graphite's neutral charcoal without inference.
    const [graphite, assay] = await Promise.all([
      fs.readFile(path.join(shotsDir, "workbench-dark.png")),
      fs.readFile(path.join(shotsDir, "workbench-assay.png"))
    ]);
    const comparison = await browser.newPage({ viewport: { width: 1440, height: 470 }, colorScheme: "dark" });
    await comparison.setContent(`<!doctype html><style>body{margin:0;background:#080a0d;color:#d9e0e8;font:14px system-ui;display:flex;gap:12px;padding:12px}.theme{width:50%}h1{font-size:14px;margin:0 0 8px}img{width:100%;display:block}</style><section class="theme"><h1>Graphite</h1><img src="data:image/png;base64,${graphite.toString("base64")}"></section><section class="theme"><h1>Assay</h1><img src="data:image/png;base64,${assay.toString("base64")}"></section>`);
    await comparison.screenshot({ path: path.join(shotsDir, "graphite-vs-assay.png") });
    await comparison.close();

    await page.keyboard.press("Control+F");
    await page.locator(".diff-search input").fill("legacy");
    await page.waitForTimeout(100);
    await page.screenshot({ path: path.join(shotsDir, "search.png") });
    await page.keyboard.press("Escape");

    const queueBox = await page.locator(".queue").boundingBox();
    if (queueBox) {
      await page.screenshot({
        path: path.join(shotsDir, "queue.png"),
        clip: {
          x: queueBox.x,
          y: queueBox.y,
          width: Math.min(480, queueBox.width),
          height: Math.min(720, queueBox.height)
        }
      });
    }

    const inspectorBox = await page.locator(".inspector").boundingBox();
    if (inspectorBox) {
      await page.screenshot({
        path: path.join(shotsDir, "inspector.png"),
        clip: {
          x: inspectorBox.x,
          y: inspectorBox.y,
          width: inspectorBox.width,
          height: Math.min(720, inspectorBox.height)
        }
      });
    }

    await selectTheme(page, "paper");
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(shotsDir, "workbench-light.png") });

    await selectTheme(page, "graphite");
    await page.keyboard.press("f");
    await page.locator(".focus-card").waitFor({ state: "visible" });
    // Let the tray-slide entrance settle before capturing.
    await page.waitForTimeout(450);
    await page.screenshot({ path: path.join(shotsDir, "focus.png") });
    await page.locator(".focus-exit").click();
    await page.locator(".focus-card").waitFor({ state: "hidden" });

    const reportPage = await browser.newPage({ viewport: { width: 1200, height: 900 }, colorScheme: "light" });
    await reportPage.setContent(await fs.readFile(reportPath, "utf8"));
    await reportPage.screenshot({ path: path.join(shotsDir, "report.png") });
    await reportPage.close();

    const timelineButton = page.getByRole("button", { name: "Timeline", exact: true });
    await timelineButton.click();
    await page.locator(".timeline-panel").waitFor({ state: "visible" });
    await page.locator(".timeline-empty, .timeline-session").waitFor({ state: "visible" });
    await page.screenshot({ path: path.join(shotsDir, "timeline.png") });
    await page.locator(".timeline-panel").getByRole("button", { name: "Close", exact: true }).click();
    }

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
    // The completion figures deliberately enter in a stagger; wait through
    // the final spring so documentation never captures an intermediate frame.
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(shotsDir, "completion.png") });
  } finally {
    await browser.close();
  }
} finally {
  child.kill();
}

console.log(`screenshots written to ${shotsDir}`);

async function selectTheme(page: Page, theme: Theme): Promise<void> {
  await page.getByRole("button", { name: "Theme", exact: true }).click();
  await page.getByRole("menuitemradio", { name: THEME_LABEL[theme], exact: true }).click();
  await page.locator(`html[data-theme="${theme}"]`).waitFor();
}

function run(command: string, args: string[], cwd: string, env = process.env): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: "inherit",
      windowsHide: true,
      // pnpm.cmd needs a shell on Windows; node.exe must not be shell-split at Program Files.
      shell: process.platform === "win32" && !command.toLowerCase().endsWith(".exe")
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
