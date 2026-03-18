# @getulionm/selector-shot-playwright

`@getulionm/selector-shot-playwright` captures selector screenshots and callsite metadata from Playwright tests so the Selector Shot VS Code extension can show CodeLens previews in source files.

## Install

```bash
npm install -D @getulionm/selector-shot-playwright
```

## Basic setup

Create a shared setup file and install Selector Shot on Playwright's `test` object:

```ts
import { test } from "@playwright/test";
import { installSelectorShot } from "@getulionm/selector-shot-playwright";

if (process.env.SELECTOR_SHOT_CAPTURE === "1") {
  installSelectorShot(test, {
    outDir: ".selector-shot"
  });
}

export { test };
```

Then import that `test` in your specs instead of importing `test` directly from `@playwright/test`.

Run capture mode with:

```bash
npx selector-shot-update
```

If your test command is custom:

```bash
npx selector-shot-update npm run test:e2e
```

## Recommended workspace model

Run capture from the same app or package folder you open in VS Code.

- standalone app: run from the app root
- monorepo package: run from the package folder

This keeps capture output local in `.selector-shot`, which matches the Selector Shot extension's default discovery glob.

## API

```ts
installSelectorShot(test, options?)
wireSelectorShot(test, options?)
selectorShot(options?)
```

Main options:

- `outDir`
- `maxPerTest`
- `captureStrategy`
- `captureTimeoutMs`
- `preCaptureWaitMs`
- `captureRetries`
- `maxAfterEachMs`
- `skipMissingSelectors`
- `missingSelectorTimeoutMs`
- `captureAssertions`

## License

MIT
