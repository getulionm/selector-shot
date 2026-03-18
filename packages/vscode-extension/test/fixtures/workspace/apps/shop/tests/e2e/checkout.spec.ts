import { test, expect } from "@playwright/test";

test("nested monorepo style spec", async ({ page }) => {
  await page.goto("https://example.com");
  await expect(page.locator("form[data-testid='checkout']")).toBeVisible();
});
