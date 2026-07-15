import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readReviewState, updateHunkStatus } from "./state.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("review state persistence", () => {
  it("serializes concurrent status updates without losing a decision", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "sift-state-"));
    roots.push(root);

    await Promise.all([
      updateHunkStatus(root, "first", "approved"),
      updateHunkStatus(root, "second", "flagged", "Needs tests")
    ]);

    const { state } = await readReviewState(root);
    expect(state.hunks.first?.status).toBe("approved");
    expect(state.hunks.second).toMatchObject({ status: "flagged", note: "Needs tests" });
  });
});
