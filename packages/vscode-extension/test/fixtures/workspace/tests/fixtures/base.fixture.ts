import { test as base, expect } from "@playwright/test";

export const test = base.extend({
  appName: async ({}, use) => {
    await use("selector-shot");
  }
});

export { expect };
