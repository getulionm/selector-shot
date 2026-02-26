# Selector Shot (VS Code Extension)

Shows `Open selector screenshot` CodeLens above source lines that have:
- selector-shot metadata (`.selector-shot/**/*.json`)
- a concrete selector expression on that exact line:
  - string-like selector literal (`'...'`, `"..."`, or `` `...` ``), or
  - selector member reference (example: `selectors.firstName`)

## Install

1. Build the VSIX:
```bash
npm -w selector-shot-vscode-extension run package
```
2. In VS Code: Extensions -> `...` -> `Install from VSIX...`
3. Select `packages/vscode-extension/selector-shot-vscode-extension-0.0.1.vsix`

## Quickstart

1. Install dependencies in client repo:
```bash
npm install -D @playwright/test @selector-shot/playwright
```
2. Create `tests/setup.selector-shot.ts`:
```ts
import { test } from "@playwright/test";
import { installSelectorShot } from "@selector-shot/playwright";

if (process.env.SELECTOR_SHOT_CAPTURE === "1") {
  installSelectorShot(test, {
    outDir: ".selector-shot",
    maxPerTest: 60,
    captureTimeoutMs: 7000,
    captureRetries: 2
  });
}

export { test };
```

`installSelectorShot` resilience options:
- `captureTimeoutMs` (default: `5000`)
- `preCaptureWaitMs` (default: `2000`)
- `captureRetries` (default: `2`)
- `retryDelayMs` (default: `200`)
3. Add script:
```json
{
  "scripts": {
    "test:selector-shot-update": "selector-shot-update"
  }
}
```
4. Run capture:
```bash
npm run test:selector-shot-update
```
5. Open spec file in VS Code and run `Selector Shot: Refresh Index` once.

## Monorepo Note

If metadata is at repo root but your workspace is a package folder, set:
- `selectorShot.dataGlob`: `../.selector-shot/**/*.json`

## Commands

- `Selector Shot: Refresh Index`
- `Selector Shot: Open Screenshot`

The extension also auto-refreshes when selector-shot metadata files change, and when VS Code regains focus or active editor changes.

## Settings

- `selectorShot.dataGlob` (default: `.selector-shot/**/*.json`)
- `selectorShot.onlyCaptured` (default: `true`)
  - prefers `captured`
  - falls back to newest available status for a line when no `captured` exists
  - successful entries require an existing image file
  - failed entries can still show CodeLens (clicking shows failure details)

## Troubleshooting

No CodeLens:
1. Confirm `.selector-shot/**/*.json` exists.
2. Confirm `selectorShot.dataGlob` matches your workspace layout.
3. Wait briefly for auto-refresh, or run `Selector Shot: Refresh Index`.
4. Verify the target source line contains a concrete selector expression (literal or member reference like `selectors.firstName`).
5. Check `Output` -> `Log (Extension Host)` for runtime errors.

`Selector screenshot not found on disk`:
1. Re-run capture mode.
2. Refresh index.
3. Verify metadata `imagePath` exists on disk.
