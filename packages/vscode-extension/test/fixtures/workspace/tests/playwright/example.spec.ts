import { expect } from "@playwright/test";
import { test } from "./setup.selector-shot";

test("captures selector screenshot from real page", async ({ page }) => {
  await page.goto("https://example.com");

  const moreInfoLink = page.locator("a[href*='iana.org/domains/example']");
  await expect(moreInfoLink).toBeVisible();
});

const selectors = {
  firstName: "#firstName",
  birthdate: "#birthdate"
};

export async function fillFirstName(page: any, value: string) {
  await page.locator(selectors.firstName).fill(value);
}

export async function fillBirthdate(page: any, value: string) {
  await page.locator(selectors.birthdate).fill(value);
}

export async function fillByLiteral(page: any, value: string) {
  await page.locator("#id").fill(value);
}

export async function fillByVariable(page: any, value: string) {
  const selector1 = "#dynamic";
  await page.locator(selector1).fill(value);
}
