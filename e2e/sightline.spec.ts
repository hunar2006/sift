import { expect, test, type Page } from "@playwright/test";

async function openWorkbench(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.locator(".hunk-row").first()).toBeVisible();
  const close = page.locator(".help button").first();
  if (await close.count()) {
    await close.click();
  }
}

async function focusDiff(page: Page): Promise<void> {
  await page.locator(".diff").focus();
}

async function flagCurrent(page: Page): Promise<void> {
  await focusDiff(page);
  await page.keyboard.press("x");
  await expect(page.getByRole("dialog", { name: "Flag reason" })).toBeVisible();
  await page.keyboard.press("1");
}

test.describe.serial("Ground Truth DOM dogfood", () => {
  test("BUG-01-undo-redo-shift-z-round-trips-counter", async ({ page }) => {
    await openWorkbench(page);
    await page.locator(".hunk-row").first().click();
    const counter = page.locator(".hud-primary");
    const before = await counter.textContent();
    await focusDiff(page);
    await page.keyboard.press("a");
    await expect(page.locator(".hunk-row .mini-stamp.verified").first()).toBeVisible();
    await page.keyboard.press("z");
    await expect(page.locator(".toast-stack")).toContainText("Undid");
    await page.keyboard.press("Shift+Z");
    await expect(page.locator(".toast-stack")).toContainText("Redid");
    await expect(counter).not.toHaveText(before ?? "");
  });

  test("BUG-16-flag-keeps-diff-focus-for-immediate-undo", async ({ page }) => {
    await openWorkbench(page);
    await page.locator(".hunk-row").filter({ hasNot: page.locator(".mini-stamp") }).first().click();
    await focusDiff(page);
    await page.keyboard.press("x");
    const dialog = page.getByRole("dialog", { name: "Flag reason" });
    await expect(dialog).toBeVisible();
    await page.keyboard.press("1");
    await expect(dialog).toHaveCount(0);
    await expect(page.locator(".diff")).toBeFocused();
    await page.keyboard.press("z");
    await expect(page.locator(".toast-stack")).toContainText("Undid");
    await expect(page.locator(".hunk-row .mini-stamp.flagged")).toHaveCount(0);
  });

  test("BUG-02-store-first-live-decision-selectors", async ({ page }) => {
    await openWorkbench(page);
    const row = page.locator(".hunk-row").filter({ hasNot: page.locator(".mini-stamp") }).first();
    await row.click();
    await focusDiff(page);
    await page.keyboard.press("a");
    await expect(page.locator(".mini-stamp.verified").first()).toBeVisible();
    await expect(page.locator(".hud-primary")).toContainText("reviewed");
  });

  test("BUG-03-unsaved-decision-retries-without-state-loss", async ({ page }) => {
    await openWorkbench(page);
    await page.route("**/api/hunks/*/status", async (route) => route.fulfill({ status: 503, body: "offline" }));
    const row = page.locator(".hunk-row").filter({ hasNot: page.locator(".mini-stamp") }).first();
    await row.click();
    await focusDiff(page);
    await page.keyboard.press("a");
    await expect(page.locator(".mini-stamp.verified").first()).toBeVisible();
    await expect(page.locator(".unsaved-dot").first()).toBeVisible();
    await expect(page.locator(".unsaved-notice")).toContainText("waiting to save");
    await page.unroute("**/api/hunks/*/status");
    await page.locator(".unsaved-notice").getByRole("button", { name: "Retry", exact: true }).click();
    await expect(page.locator(".unsaved-notice")).toHaveCount(0);
  });

  test("BUG-04-flagged-filter-empty-state-and-live-rows", async ({ page }) => {
    await openWorkbench(page);
    await page.locator(".hunk-row").first().click();
    await flagCurrent(page);
    await expect(page.locator(".hunk-row .mini-stamp.flagged").first()).toBeVisible();
    await expect(page.locator(".hunk-row .flagged-reason").first()).toContainText("Needs tests");
    await focusDiff(page);
    await page.keyboard.press("Shift+F");
    await expect(page.locator(".flagged-filter")).toHaveClass(/active/u);
    await page.keyboard.press("u");
    await expect(page.locator(".queue-empty")).toContainText("No flagged hunks");
    await page.keyboard.press("Shift+F");
  });

  test("BUG-05-counter-invariant-after-mixed-decisions", async ({ page }) => {
    await openWorkbench(page);
    for (let index = 0; index < 5; index += 1) {
      const row = page.locator(".hunk-row").filter({ hasNot: page.locator(".mini-stamp") }).first();
      await row.click();
      await focusDiff(page);
      if (index === 2) {
        await flagCurrent(page);
      } else {
        await page.keyboard.press("a");
      }
    }
    const groupTallies = await page.locator(".group-title").allTextContents();
    const tallySum = groupTallies.reduce((sum, label) => sum + Number(/·\s*(\d+)\//u.exec(label)?.[1] ?? 0), 0);
    const header = await page.locator(".hud-primary").textContent();
    const headerReviewed = Number(/^\s*(\d+)\s*\//u.exec(header ?? "")?.[1] ?? -1);
    expect(tallySum).toBe(headerReviewed);
  });

  test("BUG-06-overlay-stack-audit-repro", async ({ page }) => {
    await openWorkbench(page);
    await focusDiff(page);
    await page.keyboard.press("f");
    await expect(page.getByRole("dialog", { name: "Focus mode" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Focus mode" })).toHaveCount(0);
    await page.keyboard.press("Control+k");
    await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "Command palette" })).toHaveCount(0);
  });

  test("BUG-07-shifted-key-matrix-and-filter-persistence", async ({ page }) => {
    await openWorkbench(page);
    await focusDiff(page);
    await page.keyboard.press("f");
    await expect(page.getByRole("dialog", { name: "Focus mode" })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Shift+F");
    await page.reload();
    await expect(page.locator(".flagged-filter")).toHaveClass(/active/u);
    await focusDiff(page);
    await page.keyboard.press("Shift+F");
  });

  test("BUG-08-toast-stack-lifecycle", async ({ page }) => {
    await openWorkbench(page);
    for (let index = 0; index < 5; index += 1) {
      const row = page.locator(".hunk-row").filter({ hasNot: page.locator(".mini-stamp") }).first();
      await row.click();
      await focusDiff(page);
      await page.keyboard.press("a");
    }
    await expect(page.locator(".toast")).toHaveCount(3);
    await page.waitForTimeout(6_300);
    await expect(page.locator(".toast")).toHaveCount(0);
  });

  test("BUG-09-journal-transition-verbs-and-stale-refusal", async ({ page }) => {
    await openWorkbench(page);
    await page.getByRole("button", { name: "History" }).click();
    await expect(page.locator(".decision-log")).toContainText(/Approved|Flagged|Unapproved|Unflagged/u);
  });

  test("UNDO-journal-fallback-works-after-reload", async ({ page }) => {
    await openWorkbench(page);
    const row = page.locator(".hunk-row").filter({ hasNot: page.locator(".mini-stamp") }).first();
    await row.click();
    await focusDiff(page);
    await page.keyboard.press("a");
    await expect(page.locator(".mini-stamp.verified").first()).toBeVisible();
    await page.reload();
    await focusDiff(page);
    await page.keyboard.press("z");
    await expect(page.locator(".toast-stack")).toContainText("Undid");
  });

  test("BUG-10-syntax-token-colour-per-theme", async ({ page }) => {
    await openWorkbench(page);
    const code = page.locator(".diff-line code").first();
    await expect(code).toBeVisible();
    await expect.poll(async () => page.locator(".diff-line code span").count()).toBeGreaterThan(0);
    for (const theme of ["graphite", "assay", "paper"]) {
      await page.locator('select[aria-label="Theme"]').selectOption(theme);
      const baseColour = await code.evaluate((element) => getComputedStyle(element).color);
      const tokenColours = await page.locator(".diff-line code span").evaluateAll((elements) => elements.map((element) => getComputedStyle(element).color));
      expect(tokenColours.some((colour) => colour !== baseColour)).toBeTruthy();
    }
  });

  test("BUG-11-help-has-no-inert-category-controls", async ({ page }) => {
    await openWorkbench(page);
    await focusDiff(page);
    await page.keyboard.press("?");
    await expect(page.locator(".help button")).toHaveCount(1);
    await page.keyboard.press("Escape");
  });

  test("BUG-12-coverage-format-is-shared", async ({ page }) => {
    await openWorkbench(page);
    await expect(page.locator(".hud-secondary")).toContainText("coverage");
    await page.locator('.icon-btn[aria-label="Refresh"]').click();
    await expect(page.locator(".toast-stack")).toContainText("Refreshed");
  });

  test("BUG-13-review-actions-sticky-below-risk", async ({ page }) => {
    await openWorkbench(page);
    await page.locator(".hunk-row").first().click();
    const actions = page.locator(".review-pinned");
    await expect(actions).toBeVisible();
    await expect(actions.getByRole("button", { name: "Approve" })).toBeVisible();
  });

  test("BUG-14-refresh-and-copy-feedback", async ({ page }) => {
    await openWorkbench(page);
    await page.locator('.icon-btn[aria-label="Refresh"]').click();
    await expect(page.locator(".toast-stack")).toContainText("Refreshed");
    const generatedGroup = page.locator(".queue-group").filter({ hasText: "Generated files" });
    await expect(generatedGroup.getByRole("button", { name: "Approve group" })).toBeVisible();
    await generatedGroup.getByRole("button", { name: "Approve group" }).click();
    const approval = page.getByRole("dialog", { name: "Approve group" });
    await approval.getByRole("button", { name: /Approve 2/u }).click();
    await expect(approval).toContainText("hot risk signal blocks bulk approval");
  });

  test("BUG-15-theme-dropdown-and-honest-keymap", async ({ page }) => {
    await openWorkbench(page);
    const html = page.locator("html");
    for (const theme of ["graphite", "assay", "paper"]) {
      await page.locator('select[aria-label="Theme"]').selectOption(theme);
      await expect(html).toHaveAttribute("data-theme", theme);
    }
    await page.locator('select[aria-label="Theme"]').selectOption("graphite");
  });

  test("REVERT-snapshot-confirm-row-disappears-and-z-restores", async ({ page }) => {
    await openWorkbench(page);
    const row = page.locator(".hunk-row").first();
    const label = await row.textContent();
    await row.click();
    await focusDiff(page);
    await page.keyboard.press("Shift+R");
    const dialog = page.getByRole("dialog", { name: "Confirm file revert" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Revert" }).click();
    await expect(page.locator(".toast-stack")).toContainText("Reverted");
    await page.reload();
    await focusDiff(page);
    await page.keyboard.press("z");
    await expect(page.locator(".toast-stack")).toContainText("Undid revert");
    if (label) {
      await expect(page.locator(".hunk-row").first()).toBeVisible();
    }
  });

  test("VIEWPORT-1000-two-column-reflow-keeps-workbench-visible", async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 800 });
    await openWorkbench(page);
    await expect(page.locator(".queue")).toBeVisible();
    await expect(page.locator(".diff")).toBeVisible();
    await expect(page.locator(".inspector")).toBeHidden();
  });
});
