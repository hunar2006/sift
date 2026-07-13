/** Render a scoped, reviewable adjustment without writing to the repository. */
export function suppressionRuleFor(code: string, file: string, label: string): string {
  const separator = file.lastIndexOf("/");
  const directoryGlob = separator === -1 ? "**" : `${file.slice(0, separator + 1)}**`;

  return `adjust:
  - code: ${code}
    paths:
      - "${directoryGlob}"
    weight: 0
    # ${label}: expected for this directory; review before keeping.`;
}
