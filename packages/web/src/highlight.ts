import type { DiffLine } from "@sift-review/core";
import { assayDark, assayLight, type AssayThemeName } from "./assay-themes.js";

interface ShikiHighlighter {
  codeToHtml(code: string, options: { lang: string; theme: string }): string;
}

interface ShikiCoreModule {
  createHighlighterCore(options: {
    engine: () => unknown;
    themes: Array<typeof assayDark | typeof assayLight>;
    langs: unknown[];
  }): Promise<ShikiHighlighter>;
}

interface ShikiEngineModule {
  createJavaScriptRegexEngine(options: { forgiving: boolean }): unknown;
}

type LanguageModule = { default: unknown };

const cache = new Map<string, Promise<string[] | null>>();
const highlighters = new Map<string, Promise<ShikiHighlighter | null>>();

const LANGUAGE_ALIASES: Record<string, string> = {
  text: "text",
  binary: "text",
  typescript: "typescript",
  tsx: "tsx",
  javascript: "javascript",
  jsx: "jsx",
  python: "python",
  go: "go",
  rust: "rust",
  java: "java",
  kotlin: "kotlin",
  c: "c",
  cpp: "cpp",
  csharp: "csharp",
  ruby: "ruby",
  shell: "bash",
  sql: "sql",
  html: "html",
  xml: "xml",
  css: "css",
  yaml: "yaml",
  toml: "toml",
  ini: "ini"
};

const languageLoaders: Record<string, () => Promise<LanguageModule>> = {
  typescript: () => import("shiki/dist/langs/typescript.mjs"),
  tsx: () => import("shiki/dist/langs/tsx.mjs"),
  javascript: () => import("shiki/dist/langs/javascript.mjs"),
  jsx: () => import("shiki/dist/langs/jsx.mjs"),
  python: () => import("shiki/dist/langs/python.mjs"),
  go: () => import("shiki/dist/langs/go.mjs"),
  rust: () => import("shiki/dist/langs/rust.mjs"),
  java: () => import("shiki/dist/langs/java.mjs"),
  kotlin: () => import("shiki/dist/langs/kotlin.mjs"),
  c: () => import("shiki/dist/langs/c.mjs"),
  cpp: () => import("shiki/dist/langs/cpp.mjs"),
  csharp: () => import("shiki/dist/langs/csharp.mjs"),
  ruby: () => import("shiki/dist/langs/ruby.mjs"),
  bash: () => import("shiki/dist/langs/bash.mjs"),
  sql: () => import("shiki/dist/langs/sql.mjs"),
  html: () => import("shiki/dist/langs/html.mjs"),
  xml: () => import("shiki/dist/langs/xml.mjs"),
  css: () => import("shiki/dist/langs/css.mjs"),
  yaml: () => import("shiki/dist/langs/yaml.mjs"),
  toml: () => import("shiki/dist/langs/toml.mjs"),
  ini: () => import("shiki/dist/langs/ini.mjs")
};

export function highlightDiffLines(
  hunkId: string,
  language: string,
  lines: DiffLine[],
  theme: AssayThemeName = "assay-dark"
): Promise<string[] | null> {
  const lang = LANGUAGE_ALIASES[language] ?? "text";
  if (lang === "text") {
    return Promise.resolve(null);
  }
  const key = `${hunkId}:${lang}:${theme}:${lines.map((line) => line.text).join("\n")}`;
  const existing = cache.get(key);
  if (existing) {
    return existing;
  }
  const promise = highlightLines(lang, lines, theme).catch(() => null);
  cache.set(key, promise);
  return promise;
}

async function highlightLines(lang: string, lines: DiffLine[], theme: AssayThemeName): Promise<string[] | null> {
  const highlighter = await highlighterFor(lang);
  if (!highlighter) {
    return null;
  }
  return lines.map((line) => innerCodeHtml(highlighter.codeToHtml(line.text || " ", { lang, theme })));
}

function highlighterFor(lang: string): Promise<ShikiHighlighter | null> {
  const existing = highlighters.get(lang);
  if (existing) {
    return existing;
  }
  const loader = languageLoaders[lang];
  if (!loader) {
    return Promise.resolve(null);
  }
  const promise = Promise.all([import("shiki/core"), import("shiki/engine/javascript"), loader()])
    .then(([core, engine, language]) =>
      (core as unknown as ShikiCoreModule).createHighlighterCore({
        engine: () => (engine as unknown as ShikiEngineModule).createJavaScriptRegexEngine({ forgiving: true }),
        themes: [assayDark, assayLight],
        langs: [language.default]
      })
    )
    .catch(() => null);
  highlighters.set(lang, promise);
  return promise;
}

function innerCodeHtml(html: string): string {
  return html.match(/<code[^>]*>([\s\S]*?)<\/code>/)?.[1] ?? escapeHtml(html);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
