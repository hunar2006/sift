import type { LanguageInfo } from "./languages.js";

interface CommentSegment {
  content: string;
  isDocComment: boolean;
}

const TS_JS_LANGUAGES = new Set(["typescript", "tsx", "javascript", "jsx"]);

/**
 * Finds the directive token in a source-code comment, if any.
 *
 * This is deliberately a small lexical check rather than a parser: it tracks
 * same-line quotes before locating a comment marker, which rejects detectable
 * string-literal near misses. Template interpolation and malformed source are
 * best-effort by design.
 */
export function directiveCommentToken(line: string, language: LanguageInfo): string | null {
  if (language.name === "go" && /^\s*\/\/\s*Deprecated:/.test(line)) {
    return "// Deprecated:";
  }
  for (const segment of commentSegments(line, language)) {
    const content = segment.content;

    if (TS_JS_LANGUAGES.has(language.name)) {
      const token = matchToken(content, [
        /@ts-expect-error\b/,
        /@ts-ignore\b/,
        /@ts-nocheck\b/,
        /\beslint-disable(?:-[a-z]+)*\b/,
        /\bprettier-ignore\b/,
        /\bbiome-ignore\b/,
        /\bistanbul ignore\b/,
        /\bc8 ignore\b/,
        /\bwebpackIgnore\s*:\s*true\b/,
        /@jsxImportSource\b/,
        /@jsx\b/
      ]);
      if (token) {
        return token;
      }
    }

    if (language.name === "python") {
      const token = matchToken(content, [
        /\bruff:\s*noqa\b/,
        /\btype:\s*ignore\b/,
        /\bpragma:\s*no cover\b/,
        /\bmypy:/,
        /\bfmt:\s*(?:off|on)\b/,
        /\bnoqa\b/
      ]);
      if (token) {
        return `# ${token}`;
      }
    }

    if (language.name === "go") {
      const token = matchToken(content, [/\bnolint\b/, /\bgo:[A-Za-z0-9_-]+\b/, /\+build\b/]);
      if (token) {
        return token === "+build" ? "// +build" : `//${token}`;
      }
    }

    if (language.name === "rust" && /\brustfmt::skip\b/.test(content)) {
      return "// rustfmt::skip";
    }

    if (language.name === "java" || language.name === "kotlin") {
      if (/\bnoinspection\b/.test(content)) {
        return "// noinspection";
      }
      if (/\bNOSONAR\b/.test(content)) {
        return "NOSONAR";
      }
    }

    const generic = matchToken(content, [/\bcoverage:ignore\b/, /\bcodecov ignore\b/]);
    if (generic) {
      return generic;
    }

    if (language.declarationTags || (TS_JS_LANGUAGES.has(language.name) && segment.isDocComment)) {
      const token = matchToken(content, [/@deprecated\b/, /@internal\b/]);
      if (token) {
        return token;
      }
    }
  }
  return null;
}

export function isDirectiveComment(line: string, language: LanguageInfo): boolean {
  return directiveCommentToken(line, language) !== null;
}

function matchToken(content: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match?.[0]) {
      return match[0];
    }
  }
  return null;
}

function commentSegments(line: string, language: LanguageInfo): CommentSegment[] {
  const segments: CommentSegment[] = [];
  for (const marker of language.lineComments) {
    const start = indexOfOutsideQuotes(line, marker);
    if (start >= 0) {
      segments.push({ content: line.slice(start + marker.length), isDocComment: false });
    }
  }
  for (const [startMarker, endMarker] of language.blockComments) {
    const start = indexOfOutsideQuotes(line, startMarker);
    if (start >= 0) {
      const end = line.indexOf(endMarker, start + startMarker.length);
      segments.push({
        content: line.slice(start + startMarker.length, end >= 0 ? end : undefined),
        isDocComment: line.slice(start).startsWith("/**")
      });
    }
  }
  const trimmed = line.trim();
  if (language.blockComments.length > 0 && trimmed.startsWith("*")) {
    segments.push({ content: trimmed.slice(1), isDocComment: true });
  }
  return segments;
}

function indexOfOutsideQuotes(text: string, marker: string): number {
  let quote: "'" | '"' | "`" | undefined;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quote) {
      if (character === "\\") {
        index += 1;
      } else if (character === quote) {
        quote = undefined;
      }
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      quote = character;
      continue;
    }
    if (text.startsWith(marker, index)) {
      return index;
    }
  }
  return -1;
}
