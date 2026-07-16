import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import gifenc from "gifenc";
import { chromium, type Page } from "playwright";

interface GifStream {
  writeFrame(index: Uint8Array, width: number, height: number, options: { palette?: number[][]; delay: number; repeat?: number; dispose?: number }): void;
  finish(): void;
  bytes(): Uint8Array;
}

interface Gifenc {
  GIFEncoder(): GifStream;
  quantize(rgba: Uint8Array, colors: number, options?: { format?: "rgb444" }): number[][];
  applyPalette(rgba: Uint8Array, palette: number[][], format?: "rgb444"): Uint8Array;
}

const { GIFEncoder, applyPalette, quantize } = gifenc as Gifenc;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const demoRoot = path.join(root, ".demo");
const demoRepo = path.join(demoRoot, "repo");
const output = path.join(root, "docs", "demo.gif");
const cli = path.join(root, "packages", "cli", "dist", "index.js");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const width = 960;
const height = 500;
const frameDelayMs = 100;
const repeatsPerStep = 24;

await run(pnpm, ["demo", "--", "--headless"], root);
const child = spawn(process.execPath, [cli, "--no-open", "--port", "4313"], {
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
    const page = await browser.newPage({ viewport: { width, height }, colorScheme: "dark", deviceScaleFactor: 1 });
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.locator(".shell").waitFor({ state: "visible" });
    const helpClose = page.locator(".help button").first();
    if (await helpClose.count()) await helpClose.click();

    const frames: Uint8Array[] = [];
    await capture(frames, page);
    await page.locator(".hunk-row").first().click();
    await focusDiff(page);
    await page.keyboard.press("a");
    await page.locator(".mini-stamp.verified").first().waitFor({ state: "visible" });
    await capture(frames, page);
    await page.locator(".hunk-row").filter({ hasNot: page.locator(".mini-stamp") }).first().click();
    await focusDiff(page);
    await page.keyboard.press("x");
    await page.getByRole("dialog", { name: "Flag reason" }).waitFor({ state: "visible" });
    await page.keyboard.press("1");
    await page.locator(".mini-stamp.flagged").first().waitFor({ state: "visible" });
    await capture(frames, page);
    await page.keyboard.press("z");
    await page.locator(".toast-stack").getByText(/Undid/u).waitFor({ state: "visible" });
    await capture(frames, page);
    await focusDiff(page);
    await page.keyboard.press("f");
    await page.locator(".focus-card").waitFor({ state: "visible" });
    await capture(frames, page);

    const gif = encode(frames, width, height);
    if (gif.byteLength > 3 * 1024 * 1024) {
      throw new Error(`docs/demo.gif is ${(gif.byteLength / 1024 / 1024).toFixed(2)} MB; the 3 MB release limit was exceeded.`);
    }
    await fs.writeFile(output, gif);
    console.log(`GIF written to ${path.relative(root, output)} (${(gif.byteLength / 1024).toFixed(0)} kB; ${frames.length * repeatsPerStep * frameDelayMs / 1000}s at ${1000 / frameDelayMs} fps).`);
  } finally {
    await browser.close();
  }
} finally {
  child.kill();
}

async function capture(frames: Uint8Array[], page: Page): Promise<void> {
  await page.waitForTimeout(180);
  const png = await page.screenshot({ type: "png" });
  const dataUrl = `data:image/png;base64,${png.toString("base64")}`;
  const raw = await page.evaluate(async ({ source, targetWidth, targetHeight }) => {
    const image = new Image();
    image.src = source;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Canvas context is unavailable.");
    context.drawImage(image, 0, 0, targetWidth, targetHeight);
    const bytes = context.getImageData(0, 0, targetWidth, targetHeight).data;
    let binary = "";
    for (let start = 0; start < bytes.length; start += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
    }
    return btoa(binary);
  }, { source: dataUrl, targetWidth: width, targetHeight: height });
  frames.push(new Uint8Array(Buffer.from(raw, "base64")));
}

function encode(frames: readonly Uint8Array[], frameWidth: number, frameHeight: number): Uint8Array {
  const sample = new Uint8Array(frames.reduce((total, frame) => total + frame.length, 0));
  let offset = 0;
  for (const frame of frames) {
    sample.set(frame, offset);
    offset += frame.length;
  }
  const palette = quantize(sample, 16, { format: "rgb444" });
  const gif = GIFEncoder() as GifStream;
  let first = true;
  for (const frame of frames) {
    const indexed = applyPalette(frame, palette, "rgb444");
    for (let index = 0; index < repeatsPerStep; index += 1) {
      gif.writeFrame(indexed, frameWidth, frameHeight, {
        ...(first ? { palette, repeat: 0 } : {}),
        delay: frameDelayMs,
        dispose: 1
      });
      first = false;
    }
  }
  gif.finish();
  return gif.bytes();
}

function focusDiff(page: Page): Promise<void> {
  return page.locator(".diff").focus();
}

function run(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit",
      windowsHide: true,
      shell: process.platform === "win32" && !command.toLowerCase().endsWith(".exe")
    });
    child.once("error", reject);
    child.once("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited ${code ?? "null"}.`))));
  });
}

function serverUrl(process: ReturnType<typeof spawn>): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for the local Sift server: ${output.slice(-500)}`)), 20_000);
    const onData = (chunk: Buffer) => {
      output += chunk.toString();
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+/u);
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
      reject(new Error(`Sift server exited ${code ?? "null"} before it was ready: ${output.slice(-500)}`));
    });
  });
}
