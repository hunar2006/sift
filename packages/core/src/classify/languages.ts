import { extension } from "../path-utils.js";

export interface LanguageInfo {
  name: string;
  lineComments: string[];
  blockComments: Array<[string, string]>;
  importRegexes: RegExp[];
  importSpecifier(line: string): string | null;
}

const cLike: Pick<LanguageInfo, "lineComments" | "blockComments"> = {
  lineComments: ["//"],
  blockComments: [["/*", "*/"]]
};

function quotedModule(line: string): string | null {
  const match = line.match(/["']([^"']+)["']/);
  return match?.[1] ?? null;
}

function jsImportSpecifier(line: string): string | null {
  const trimmed = line.trim();
  if (trimmed.startsWith("import")) {
    return quotedModule(trimmed) ?? trimmed.replace(/\s+/g, " ");
  }
  const requireMatch = trimmed.match(/require\(["']([^"']+)["']\)/);
  return requireMatch?.[1] ?? null;
}

function pyImportSpecifier(line: string): string | null {
  return line.trim().replace(/\s+/g, " ");
}

const defaultInfo: LanguageInfo = {
  name: "text",
  lineComments: ["#"],
  blockComments: [],
  importRegexes: [],
  importSpecifier: () => null
};

const byExtension: Record<string, LanguageInfo> = {
  ts: {
    name: "typescript",
    ...cLike,
    importRegexes: [/^\s*import\b/, /^\s*(?:const|let|var)\s+.*=\s*require\(/],
    importSpecifier: jsImportSpecifier
  },
  tsx: {
    name: "tsx",
    ...cLike,
    importRegexes: [/^\s*import\b/, /^\s*(?:const|let|var)\s+.*=\s*require\(/],
    importSpecifier: jsImportSpecifier
  },
  js: {
    name: "javascript",
    ...cLike,
    importRegexes: [/^\s*import\b/, /^\s*(?:const|let|var)\s+.*=\s*require\(/],
    importSpecifier: jsImportSpecifier
  },
  jsx: {
    name: "jsx",
    ...cLike,
    importRegexes: [/^\s*import\b/, /^\s*(?:const|let|var)\s+.*=\s*require\(/],
    importSpecifier: jsImportSpecifier
  },
  py: {
    name: "python",
    lineComments: ["#"],
    blockComments: [
      ['"""', '"""'],
      ["'''", "'''"]
    ],
    importRegexes: [/^\s*import\s+/, /^\s*from\s+\S+\s+import\s+/],
    importSpecifier: pyImportSpecifier
  },
  go: {
    name: "go",
    ...cLike,
    importRegexes: [/^\s*import\b/, /^\s*["'][^"']+["']$/],
    importSpecifier: (line) => quotedModule(line) ?? line.trim()
  },
  rs: {
    name: "rust",
    ...cLike,
    importRegexes: [/^\s*use\s+.*;/],
    importSpecifier: (line) => line.trim().replace(/\s+/g, " ")
  },
  java: {
    name: "java",
    ...cLike,
    importRegexes: [/^\s*import\s+/],
    importSpecifier: (line) => line.trim().replace(/\s+/g, " ")
  },
  kt: {
    name: "kotlin",
    ...cLike,
    importRegexes: [/^\s*import\s+/],
    importSpecifier: (line) => line.trim().replace(/\s+/g, " ")
  },
  c: {
    name: "c",
    ...cLike,
    importRegexes: [/^\s*#include\s+/],
    importSpecifier: (line) => quotedModule(line) ?? line.trim()
  },
  h: {
    name: "c",
    ...cLike,
    importRegexes: [/^\s*#include\s+/],
    importSpecifier: (line) => quotedModule(line) ?? line.trim()
  },
  cpp: {
    name: "cpp",
    ...cLike,
    importRegexes: [/^\s*#include\s+/],
    importSpecifier: (line) => quotedModule(line) ?? line.trim()
  },
  cs: {
    name: "csharp",
    ...cLike,
    importRegexes: [/^\s*using\s+/],
    importSpecifier: (line) => line.trim().replace(/\s+/g, " ")
  },
  rb: {
    name: "ruby",
    lineComments: ["#"],
    blockComments: [
      ["=begin", "=end"]
    ],
    importRegexes: [/^\s*require\s+/, /^\s*load\s+/],
    importSpecifier: quotedModule
  },
  sh: {
    name: "shell",
    lineComments: ["#"],
    blockComments: [],
    importRegexes: [],
    importSpecifier: () => null
  },
  sql: {
    name: "sql",
    lineComments: ["--"],
    blockComments: [["/*", "*/"]],
    importRegexes: [],
    importSpecifier: () => null
  },
  html: {
    name: "html",
    lineComments: [],
    blockComments: [["<!--", "-->"]],
    importRegexes: [],
    importSpecifier: () => null
  },
  xml: {
    name: "xml",
    lineComments: [],
    blockComments: [["<!--", "-->"]],
    importRegexes: [],
    importSpecifier: () => null
  },
  css: {
    name: "css",
    lineComments: [],
    blockComments: [["/*", "*/"]],
    importRegexes: [/^\s*@import\s+/],
    importSpecifier: quotedModule
  },
  yaml: {
    name: "yaml",
    lineComments: ["#"],
    blockComments: [],
    importRegexes: [],
    importSpecifier: () => null
  },
  yml: {
    name: "yaml",
    lineComments: ["#"],
    blockComments: [],
    importRegexes: [],
    importSpecifier: () => null
  },
  toml: {
    name: "toml",
    lineComments: ["#"],
    blockComments: [],
    importRegexes: [],
    importSpecifier: () => null
  },
  ini: {
    name: "ini",
    lineComments: ["#", ";"],
    blockComments: [],
    importRegexes: [],
    importSpecifier: () => null
  }
};

export function languageForPath(filePath: string): LanguageInfo {
  return byExtension[extension(filePath)] ?? defaultInfo;
}

export function languageNameForPath(filePath: string): string {
  return languageForPath(filePath).name;
}
