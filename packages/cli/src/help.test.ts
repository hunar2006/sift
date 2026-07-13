import { describe, expect, it } from "vitest";
import { ROOT_HELP, commandHelp } from "./help.js";

describe("compact CLI help", () => {
  it("keeps the root help within one short terminal", () => {
    expect(ROOT_HELP.split("\n")).toHaveLength(33);
    expect(ROOT_HELP).toMatchInlineSnapshot(`
"Usage: sift [range] [options] [command]

Examples:
  sift                 Review working changes
  sift last            Review the last commit
  sift --watch         Refresh while an agent works
  sift pr 123          Review pull request 123

Review:
  sift [range]         Review a diff
  sift last [n]        Review recent commits
  sift pr [pr]         Review a pull request
  sift tui [range]     Review in a terminal

Live:
  --watch              Refresh working changes

Output:
  print [range]        Print review summary
  report               Write a review report
  stats                Show review progress
  check                Check review debt
  brief                Create an agent handoff

Setup:
  init                 Create local Sift files
  hooks                Manage capture hooks
  rules                Manage review rules
  demo                 Open a sample review

Options:
  -h, --help           Show help
  -V, --version        Show version"
`);
  });

  it("uses the same examples-first shape for commands", () => {
    expect(commandHelp("pr")).toMatchInlineSnapshot(`
"Usage: sift pr [options]

Examples:
  sift pr 123          Review pull request 123
  sift pr              Choose a pull request

Options:
  -h, --help           Show help"
`);
  });
});
