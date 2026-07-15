import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const cssPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "styles.css");
const css = readFileSync(cssPath, "utf8");

function block(selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  const body = css.slice(open + 1, close);
  const map: Record<string, string> = {};
  for (const match of body.matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/gu)) {
    map[match[1]!] = match[2]!;
  }
  return map;
}

const graphite = block(":root {");
const assay = { ...graphite, ...block(':root[data-theme="assay"] {') };
const paper = { ...graphite, ...block(':root[data-theme="paper"] {') };

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const BODY_PAIRS: Array<[string, string]> = [
  ["--text-hi", "--ink-0"], ["--text-hi", "--ink-1"], ["--text-hi", "--ink-2"],
  ["--text-lo", "--ink-0"], ["--text-lo", "--ink-1"], ["--text-lo", "--ink-2"]
];

const LARGE_PAIRS: Array<[string, string]> = [
  ["--verdict", "--ink-0"], ["--verdict", "--ink-1"], ["--critical", "--ink-0"], ["--critical", "--ink-1"],
  ["--high", "--ink-1"], ["--medium", "--ink-1"], ["--low", "--ink-1"], ["--green-text", "--ink-1"],
  ["--high-text", "--ink-1"], ["--medium-text", "--ink-1"], ["--low-text", "--ink-1"], ["--skim-text", "--ink-1"]
];

const CHIP_PAIRS: Array<[string, string]> = [
  ["--critical", "--critical-chip-bg"], ["--high-text", "--high-chip-bg"], ["--medium-text", "--medium-chip-bg"],
  ["--low-text", "--low-chip-bg"], ["--green-text", "--verdict-chip-bg"]
];

const PAPER_SECONDARY_PAIRS: Array<[string, string]> = [
  // SEC_PATH/reason metadata and line-match use --text-lo; copy-rule is the
  // visible suppression-control outline on Paper's light surface.
  ["--text-lo", "--ink-1"],
  ["--copy-rule", "--ink-1"]
];

function check(theme: Record<string, string>, fg: string, bg: string): number {
  const fgHex = theme[fg];
  const bgHex = theme[bg];
  expect(fgHex, `${fg} is defined`).toBeTruthy();
  expect(bgHex, `${bg} is defined`).toBeTruthy();
  return contrast(fgHex!, bgHex!);
}

describe.each([["graphite", graphite], ["assay", assay], ["paper", paper]])("contrast: %s theme", (_name, theme) => {
  it.each(BODY_PAIRS)("body text %s on %s meets 4.5:1", (fg, bg) => {
    expect(check(theme, fg, bg)).toBeGreaterThanOrEqual(4.5);
  });
  it.each(LARGE_PAIRS)("large/accent text %s on %s meets 3:1", (fg, bg) => {
    expect(check(theme, fg, bg)).toBeGreaterThanOrEqual(3);
  });
  if (_name === "paper") {
    it.each(PAPER_SECONDARY_PAIRS)("Paper secondary element %s on %s meets 4.5:1", (fg, bg) => {
      expect(check(theme, fg, bg)).toBeGreaterThanOrEqual(4.5);
    });
  }
  it.each(CHIP_PAIRS)("chip text %s on %s meets 3:1", (fg, bg) => {
    expect(check(theme, fg, bg)).toBeGreaterThanOrEqual(3);
  });
});
