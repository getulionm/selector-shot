import { expect, test } from "../fixtures/base.fixture";

test("custom fixture selector", async ({ page }) => {
  await page.goto("https://example.com");
  await expect(page.locator("button[data-testid='save']")).toBeVisible();
});
