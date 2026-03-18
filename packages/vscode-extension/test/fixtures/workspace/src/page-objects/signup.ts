export const selectors = {
  email: "[data-testid='signup-email']"
};

export async function fillSignupEmail(page: any, value: string) {
  await page.locator(selectors.email).fill(value);
}
