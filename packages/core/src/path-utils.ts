import path from "node:path";

export function toPosixPath(value: string): string {
  return value.replace(/\\/g, "/");
}

export function stripDiffPrefix(value: string): string {
  if (value === "/dev/null") {
    return value;
  }
  if (value.startsWith("a/") || value.startsWith("b/")) {
    return value.slice(2);
  }
  return value;
}

export function normalizeRepoRelative(filePath: string): string {
  return stripDiffPrefix(toPosixPath(filePath)).replace(/^\.\/+/, "");
}

export function basename(filePath: string): string {
  return path.posix.basename(toPosixPath(filePath));
}

export function extension(filePath: string): string {
  const base = basename(filePath).toLowerCase();
  if (base === "dockerfile" || base.startsWith("dockerfile.")) {
    return "dockerfile";
  }
  const ext = path.posix.extname(base);
  return ext.startsWith(".") ? ext.slice(1) : ext;
}

export function isParentOrChild(a: string, b: string): boolean {
  const left = path.resolve(a);
  const right = path.resolve(b);
  const relAB = path.relative(left, right);
  const relBA = path.relative(right, left);
  return (
    relAB === "" ||
    (!relAB.startsWith("..") && !path.isAbsolute(relAB)) ||
    relBA === "" ||
    (!relBA.startsWith("..") && !path.isAbsolute(relBA))
  );
}

export function safeEvidence(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > 120 ? `${collapsed.slice(0, 119)}...` : collapsed;
}
