import os from "node:os";
import path from "node:path";

export function siftHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.SIFT_HOME ? path.resolve(env.SIFT_HOME) : path.join(os.homedir(), ".sift");
}

export function claudeDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.SIFT_CLAUDE_DIR ? path.resolve(env.SIFT_CLAUDE_DIR) : path.join(os.homedir(), ".claude");
}

export function hookLogPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(siftHome(env), "provenance.jsonl");
}

export function captureErrorPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(siftHome(env), "capture-errors.log");
}
