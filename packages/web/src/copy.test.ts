import { describe, expect, it } from "vitest";
import { copyWordCount, FIRST_RUN_OVERLAY_STEPS, HELP_OVERLAY_LINES } from "./copy.js";

describe("first-run overlay copy", () => {
  it("keeps each step short and the full overlay brief", () => {
    for (const step of FIRST_RUN_OVERLAY_STEPS) {
      expect(copyWordCount([step])).toBeLessThanOrEqual(6);
    }
    expect(copyWordCount(["Keys", ...FIRST_RUN_OVERLAY_STEPS, ...HELP_OVERLAY_LINES])).toBeLessThanOrEqual(40);
  });
});
