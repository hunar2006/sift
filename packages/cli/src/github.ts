import { createInterface } from "node:readline/promises";
import type { PullRequestListItem } from "@sift-review/core";
import type { PickerIo } from "./onboarding.js";

export function pullRequestPickerLines(pullRequests: PullRequestListItem[]): string[] {
  return pullRequests.map(
    (pullRequest, index) => `  ${index + 1}  #${pullRequest.number} · ${truncateTitle(pullRequest.title)} (${pullRequest.author})`
  );
}

export function parsePullRequestChoice(value: string, pullRequests: PullRequestListItem[]): string | undefined {
  const index = Number.parseInt(value.trim(), 10);
  return Number.isSafeInteger(index) && index >= 1 && index <= pullRequests.length
    ? String(pullRequests[index - 1]?.number)
    : undefined;
}

export async function pickPullRequest(
  pullRequests: PullRequestListItem[],
  io: PickerIo = { input: process.stdin, output: process.stdout }
): Promise<string | undefined> {
  io.output.write(`Choose a pull request:\n${pullRequestPickerLines(pullRequests).join("\n")}\n  q  Quit\n`);
  const prompt = createInterface({ input: io.input, output: io.output });
  try {
    const answer = (await prompt.question("> ")).trim().toLowerCase();
    return answer === "q" ? undefined : parsePullRequestChoice(answer, pullRequests);
  } finally {
    prompt.close();
  }
}

export function truncateTitle(title: string, maximum = 60): string {
  return title.length <= maximum ? title : `${title.slice(0, Math.max(0, maximum - 3))}...`;
}
