# selector-shot

`selector-shot` is a VS Code extension that brings visibility to your Playwright selectors.

It shows selector screenshots directly in source files via CodeLens, so you can understand what each selector matched during test execution.

Under the hood, this repo also includes a helper package used by client test runs to capture selector metadata and images.

## This repo contains

- `packages/playwright-selector-shot`
  - npm package: `@selector-shot/playwright`
  - records `page.locator(...)` callsite metadata
  - captures screenshots and writes `.selector-shot/**/*.json`
- `packages/vscode-extension`
  - VS Code extension package (`.vsix`)
  - reads `.selector-shot` metadata
  - shows `Open selector screenshot` CodeLens

## Client install and usage

In a client Playwright repo:

1. Install the extension (VSIX or Marketplace).
2. Open the app or package folder you want to work in.
2. Run command: `Selector Shot: Setup Project`.
3. Run capture mode:

```bash
npx selector-shot-update
```

If your test command is custom:

```bash
npx selector-shot-update npm run test:e2e
```

By default, Selector Shot writes capture output to `.selector-shot` in the current project folder. That same folder is also the default place the VS Code extension indexes, so the recommended workflow is:

- standalone app: open the app root in VS Code and run capture there
- monorepo package: open the package folder in VS Code and run capture there

This keeps `selectorShot.dataGlob` at its default:

```json
{
  "selectorShot.dataGlob": ".selector-shot/**/*.json"
}
```

Extension-specific install details and commands are documented in:
- [packages/vscode-extension/README.md](/c:/Users/getul/Documents/Projects/selector-shot/packages/vscode-extension/README.md)

## Develop in this repo

Install workspace deps:

```bash
npm install
```

Build extension bundle:

```bash
npm run build
```

Package extension VSIX:

```bash
npm -w selector-shot-vscode-extension run package
```

Run Playwright package unit tests:

```bash
npm run test:unit
```

Run the full local verification set before a release:

```bash
npm run test:all
```

Marketplace launch guidance and the recommended compatibility matrix live in:
- [docs/marketplace-launch-checklist.md](/c:/Users/getul/Documents/Projects/selector-shot/docs/marketplace-launch-checklist.md)
