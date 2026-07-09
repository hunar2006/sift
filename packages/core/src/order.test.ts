import { describe, expect, it } from "vitest";
import { analyzeDiff } from "./pipeline.js";
import { orderReview } from "./order.js";

describe("review ordering", () => {
  it("sorts reading mode by definition before cross-file usages", () => {
    const model = analyzeDiff({
      repoRoot: "/repo",
      diffSpec: "WORKTREE",
      git: { headSha: "abc", branch: "main" },
      patch: `diff --git a/src/z-defs.ts b/src/z-defs.ts
--- a/src/z-defs.ts
+++ b/src/z-defs.ts
@@ -1 +1,3 @@
 export const existing = true;
+const makeLabel = (value: string) => value.trim();
diff --git a/src/a-use.ts b/src/a-use.ts
--- a/src/a-use.ts
+++ b/src/a-use.ts
@@ -1 +1,2 @@
 export const existing = true;
+const alpha = makeLabel(input);
diff --git a/src/b-use.ts b/src/b-use.ts
--- a/src/b-use.ts
+++ b/src/b-use.ts
@@ -1 +1,2 @@
 export const existing = true;
+const beta = makeLabel(otherInput);
`
    });

    const reading = orderReview(model.hunks, model.groups, "reading").hunks.map((hunk) => ({
      file: hunk.file,
      rank: hunk.readingRank
    }));

    expect(reading).toMatchInlineSnapshot(`
      [
        {
          "file": "src/z-defs.ts",
          "rank": 0,
        },
        {
          "file": "src/a-use.ts",
          "rank": 1,
        },
        {
          "file": "src/b-use.ts",
          "rank": 2,
        },
      ]
    `);
  });
});
