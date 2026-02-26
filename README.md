# selector-shot (POC)

POC for this workflow:

1. Run Playwright tests.
2. Capture screenshots for selectors used via `page.locator(...)`.
3. Show an `Open selector screenshot` CodeLens on the selector line in VS Code.

## What is included

- `packages/playwright-selector-shot`
  - Monkey-patches `page.locator(...)` during tests.
  - Records selector + source file/line.
  - Captures screenshot after each test and writes metadata to `.selector-shot/**`.
- `packages/vscode-extension`
  - Reads `.selector-shot/**/*.json`.
  - Adds CodeLens to matching source lines.
  - Opens screenshot when clicked.

## Quick start

1. Install deps:
```bash
npm install
```

Run tests in two modes:

Fast tests (no capture):
```bash
npm test
```

Capture tests (writes `.selector-shot` for extension):
```bash
npm run test:capture
```

2. In your Playwright test setup, wire the tracker only when capture mode is enabled:
```ts
// tests/setup.selector-shot.ts
import { test } from "@playwright/test";
import { installSelectorShot } from "@selector-shot/playwright";

if (process.env.SELECTOR_SHOT_CAPTURE === "1") {
  installSelectorShot(test, {
    outDir: ".selector-shot",
    maxPerTest: 60
  });
}

export { test };
```

3. Use that exported `test` in specs:
```ts
import { expect } from "@playwright/test";
import { test } from "./setup.selector-shot";

test("login", async ({ page }) => {
  await page.goto("https://example.com");
  await page.locator("text=More information").click();
  await expect(page.locator("h1")).toBeVisible();
});
```

Run unit tests for the playwright package only:
```bash
npm run test:unit
```

4. Build extension:
```bash
npm run build
```

5. Open `packages/vscode-extension` in VS Code and run extension host:
   - Press `F5` in extension project.
   - In the extension host, open your test file.
   - Run command: `Selector Shot: Refresh Index`.
   - You should see `Open selector screenshot` above lines with `page.locator(...)`.

## Notes and limits (POC scope)

- Tracks only `page.locator(...)` right now.
- Screenshot is taken after test run (using final DOM state).
- If selector is not visible/available, metadata is still written with `status: "failed"`.
- Extension default is to show only `captured` entries (`selectorShot.onlyCaptured = true`).
