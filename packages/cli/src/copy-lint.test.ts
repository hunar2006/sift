import { describe, expect, it } from "vitest";
import { bannedProductWords } from "./copy-lint.js";

describe("product copy lint", () => {
  it("finds the banned product words case-insensitively", () => {
    expect(bannedProductWords("A Powerful, seamless review.")).toEqual(["powerful", "seamless"]);
  });

  it("allows plain product copy", () => {
    expect(bannedProductWords("Review local changes.")).toEqual([]);
  });
});
