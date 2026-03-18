# Selector Shot Marketplace Launch Checklist

Use this before publishing a VSIX or Marketplace update so we test the extension the way real teams will install and use it.

## 1. Packaging and basic install

- Build the extension: `npm -w selector-shot-vscode-extension run package`
- Run core unit checks: `npm run test:all`
- Run VS Code integration checks: `npm run test:extension`
- Install the produced `.vsix` into a clean VS Code profile and confirm:
  - the extension activates on startup
  - `Selector Shot: Setup Project` is available
  - `Selector Shot: Refresh Index` and `Selector Shot: Open Screenshot` work

## 2. Configuration matrix

Test each of these project shapes at least once:

- TypeScript Playwright repo using `@playwright/test` directly
- JavaScript Playwright repo using `@playwright/test` directly
- Repo with a custom `base.extend(...)` fixture exporting `test`
- Monorepo package opened directly in VS Code with local `.selector-shot`
- Repo with failed captures only, to confirm fallback CodeLens behavior
- Repo with successful captures only, to confirm image opening behavior

Advanced edge case only:

- Workspace opened in one folder while `.selector-shot` is intentionally written elsewhere and `selectorShot.dataGlob` must be customized

## 3. Capture behavior matrix

Validate these option combinations in the Playwright helper package:

- `captureStrategy: "afterEach"`
- `captureStrategy: "onUse"`
- `captureStrategy: "hybrid"`
- `skipMissingSelectors: true` and `false`
- `captureAssertions: true`
- tight `maxAfterEachMs` budget to confirm graceful cutoff
- `maxPerTest` lower than actual selector count

## 4. Manual smoke pass

- Run `Selector Shot: Setup Project` in a sample repo and inspect generated edits
- Execute `npx selector-shot-update`
- Confirm `.selector-shot/**/*.json` and PNG files are written
- Open a spec file and verify CodeLens titles match success and failure states
- Delete or update a metadata file and verify auto-refresh updates the CodeLens state

## 5. Release metadata

- Replace placeholder publisher metadata in [packages/vscode-extension/package.json](/c:/Users/getul/Documents/Projects/selector-shot/packages/vscode-extension/package.json)
- Publish `@getulionm/selector-shot-playwright` so `Selector Shot: Setup Project` can auto-install the helper package successfully
- Confirm README install instructions mention Marketplace once the listing exists
