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

const ACCENT_PAIRS: Array<[string, string]> = [
  ["--verdict", "--ink-0"], ["--verdict", "--ink-1"], ["--verdict", "--ink-2"],
  ["--critical", "--ink-0"], ["--critical", "--ink-1"], ["--critical", "--ink-2"],
  ["--high", "--ink-0"], ["--high", "--ink-1"], ["--high", "--ink-2"],
  ["--medium", "--ink-0"], ["--medium", "--ink-1"], ["--medium", "--ink-2"],
  ["--low", "--ink-0"], ["--low", "--ink-1"], ["--low", "--ink-2"]
];

const CHIP_PAIRS: Array<[string, string]> = [
  ["--critical-text", "--critical"], ["--critical", "--critical-chip-bg"], ["--high-text", "--high-chip-bg"],
  ["--medium-text", "--medium-chip-bg"], ["--low-text", "--low-chip-bg"], ["--skim-text", "--low-chip-bg"],
  ["--green-text", "--verdict-chip-bg"]
];

const PAPER_SECONDARY_PAIRS: Array<[string, string]> = [
  // The Copy-rule outline borders an ink-0 control on an ink-1 surface.
  ["--copy-rule", "--ink-0"], ["--copy-rule", "--ink-1"]
];

// Meaning-carrying geometry (severity gutters, spectrum gauge) and tertiary
// text must survive on every surface step — same 3:1 bar as accent text.
const GEOMETRY_PAIRS: Array<[string, string]> = [
  ["--brass", "--ink-0"], ["--brass", "--ink-1"], ["--brass", "--ink-2"],
  ["--add", "--ink-0"], ["--del", "--ink-0"],
  ["--subtle", "--ink-0"], ["--subtle", "--ink-1"], ["--subtle", "--ink-2"]
];

// Text rendered on the verdict accent itself (primary buttons, active pills).
const ACTION_PAIRS: Array<[string, string]> = [["--on-verdict", "--verdict"]];

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
  it.each(ACCENT_PAIRS)("accent text %s on %s meets 3:1", (fg, bg) => {
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
  it.each(GEOMETRY_PAIRS)("meaning geometry %s on %s meets 3:1", (fg, bg) => {
    expect(check(theme, fg, bg)).toBeGreaterThanOrEqual(3);
  });
  it.each(ACTION_PAIRS)("action text %s on %s meets 4.5:1", (fg, bg) => {
    expect(check(theme, fg, bg)).toBeGreaterThanOrEqual(4.5);
  });
});
