const { test, expect } = require("@playwright/test");

test("javascript literal selector", async ({ page }) => {
  await page.goto("https://example.com");
  await expect(page.locator("[data-testid='hero']")).toBeVisible();
});

async function fillLegacy(page, value) {
  const legacySelector = "#legacy-input";
  await page.locator(legacySelector).fill(value);
}

module.exports = { fillLegacy };
