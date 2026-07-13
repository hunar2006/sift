const ROOT_HELP_LINES = [
  "Usage: sift [range] [options] [command]",
  "",
  "Examples:",
  "  sift                 Review working changes",
  "  sift last            Review the last commit",
  "  sift --watch         Refresh while an agent works",
  "  sift pr 123          Review pull request 123",
  "",
  "Review:",
  "  sift [range]         Review a diff",
  "  sift last [n]        Review recent commits",
  "  sift pr [pr]         Review a pull request",
  "  sift tui [range]     Review in a terminal",
  "",
  "Live:",
  "  --watch              Refresh working changes",
  "",
  "Output:",
  "  print [range]        Print review summary",
  "  report               Write a review report",
  "  stats                Show review progress",
  "  check                Check review debt",
  "  brief                Create an agent handoff",
  "",
  "Setup:",
  "  init                 Create local Sift files",
  "  hooks                Manage capture hooks",
  "  rules                Manage review rules",
  "  demo                 Open a sample review",
  "",
  "Options:",
  "  -h, --help           Show help",
  "  -V, --version        Show version"
];

export const ROOT_HELP = ROOT_HELP_LINES.join("\n");

const SUBCOMMAND_EXAMPLES: Record<string, readonly string[]> = {
  pr: ["  sift pr 123          Review pull request 123", "  sift pr              Choose a pull request"],
  last: ["  sift last            Review the last commit", "  sift last 3          Review three commits"],
  report: ["  sift report --md     Print Markdown report", "  sift report -o out.md Save a report"],
  brief: ["  sift brief           Create a review handoff", "  sift brief --flagged Handoff flagged hunks"],
  print: ["  sift print           Print working changes", "  sift print HEAD~1    Print one commit"],
  stats: ["  sift stats           Show review progress"],
  check: ["  sift check           Check review debt"],
  init: ["  sift init            Create local Sift files"],
  hooks: ["  sift hooks status    Check capture hooks"],
  rules: ["  sift rules list      Show review rules"],
  demo: ["  sift demo            Open a sample review"],
  tui: ["  sift tui             Review in a terminal"]
};

export function commandHelp(name: string): string {
  const examples = SUBCOMMAND_EXAMPLES[name] ?? [`  sift ${name}            Run ${name}`];
  return [
    `Usage: sift ${name} [options]`,
    "",
    "Examples:",
    ...examples,
    "",
    "Options:",
    "  -h, --help           Show help"
  ].join("\n");
}
