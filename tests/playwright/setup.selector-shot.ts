import { test } from "@playwright/test";
import { installSelectorShot } from "@selector-shot/playwright";

if (process.env.SELECTOR_SHOT_CAPTURE === "1") {
  installSelectorShot(test, {
    outDir: ".selector-shot",
    maxPerTest: 60
  });
}

export { test };
