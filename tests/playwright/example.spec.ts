import { expect } from "@playwright/test";
import { test } from "./setup.selector-shot";

test("captures selector screenshot string", async ({ page }) => {
  await page.goto("https://example.com");

  const moreInfoLink = page.locator("h1");
  await expect(moreInfoLink).toBeVisible();
});


test("captures selector screenshot from object", async ({ page }) => {
  await page.goto("https://example.com");

  const s = { heading: 'h1' }
  const moreInfoLink = page.locator(s.heading);
  await expect(moreInfoLink).toBeVisible();
});
