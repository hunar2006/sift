import { describe, expect, it } from "vitest";
import { suppressionRuleFor } from "./suppression-rule.js";

describe("suppressionRuleFor", () => {
  it("scopes an adjustment to the selected file directory", () => {
    expect(suppressionRuleFor("LINT_SUPPRESSED", "packages/core/src/directives.ts", "Suppression directive")).toBe(
      `adjust:
  - code: LINT_SUPPRESSED
    paths:
      - "packages/core/src/**"
    weight: 0
    # Suppression directive: expected for this directory; review before keeping.`
    );
  });
});
