import type { DiffLine } from "@sift-review/core";

interface ShikiHighlighter {
  codeToHtml(code: string, options: { lang: string; theme: string }): string;
}

interface ShikiModule {
  createHighlighter(options: { themes: string[]; langs: string[] }): Promise<ShikiHighlighter>;
}

const THEME = "github-dark";
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

export function highlightDiffLines(hunkId: string, language: string, lines: DiffLine[]): Promise<string[] | null> {
  const lang = LANGUAGE_ALIASES[language] ?? "text";
  if (lang === "text") {
    return Promise.resolve(null);
  }
  const key = `${hunkId}:${lang}:${lines.map((line) => line.text).join("\n")}`;
  const existing = cache.get(key);
  if (existing) {
    return existing;
  }
  const promise = highlightLines(lang, lines).catch(() => null);
  cache.set(key, promise);
  return promise;
}

async function highlightLines(lang: string, lines: DiffLine[]): Promise<string[] | null> {
  const highlighter = await highlighterFor(lang);
  if (!highlighter) {
    return null;
  }
  return lines.map((line) => innerCodeHtml(highlighter.codeToHtml(line.text || " ", { lang, theme: THEME })));
}

function highlighterFor(lang: string): Promise<ShikiHighlighter | null> {
  const existing = highlighters.get(lang);
  if (existing) {
    return existing;
  }
  const promise = import("shiki")
    .then((module) => (module as unknown as ShikiModule).createHighlighter({ themes: [THEME], langs: [lang] }))
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
