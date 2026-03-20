# Selector Shot (VS Code Extension)

Selector Shot captures focused screenshots from Playwright selectors like `page.locator(...)` during test runs and attaches that element visual back to the calling line of code with `Open selector screenshot` CodeLens.

It is built for QA and engineering workflows where you want to inspect what a selector matched without leaving the test file.

![Selector Shot hero](media/hero-codelens.png)

## What You Get

- focused element screenshots attached to selector callsites in code
- quick access to the matched visual from the exact line that triggered it
- setup that works with normal Playwright repos instead of asking teams to restructure them

## When CodeLens Appears

`Open selector screenshot` CodeLens appears above source lines that have:
- selector-shot metadata (`.selector-shot/**/*.json`)
- a concrete selector expression on that exact line:
  - string-like selector literal (`'...'`, `"..."`, or `` `...` ``), or
  - selector member reference (example: `selectors.firstName`)

## Install

Install `Selector Shot: Playwright` from the VS Code Marketplace.

Marketplace identifier:
- `getulionm.selector-shot-vscode-extension`

## Client Setup (Recommended)

In the client repo:
1. Install this extension from the Marketplace.
2. Open the app or package folder you want to work in.
3. Run command: `Selector Shot: Setup Project`
4. Optional: run `Selector Shot: Validate Wiring` for a read-only check.
5. Run:
```bash
npx selector-shot-update
```

If your test command is not `npm test`, pass it explicitly:
```bash
npx selector-shot-update npm run test:e2e
```

If helper auto-install is blocked in your environment, install it manually:
```bash
npm install -D @getulionm/selector-shot-playwright
```

`Selector Shot: Setup Project` performs bootstrap automatically:
- stops early unless the workspace already has `package.json`, `@playwright/test`, and a Playwright spec or `playwright.config.*`
- installs `@getulionm/selector-shot-playwright` as a dev dependency when missing
- patches an existing shared custom fixture or setup file when specs already share one
- otherwise creates one shared `setup.selector-shot.ts` or `.js` file for direct `@playwright/test` imports
- matches TypeScript vs JavaScript and ESM vs CommonJS source style
- rewrites direct `@playwright/test` entry points with a source-path-only import change because the generated setup file re-exports both `test` and `expect`
- reports why each file changed
- does not add optional package scripts

## Setup Lifecycle

1. `Selector Shot: Setup Project` wires Playwright's `test` object to the Selector Shot helper.
2. `npx selector-shot-update` runs your Playwright tests in capture mode and writes `.selector-shot` metadata plus screenshots.
3. The extension reads that capture output and shows CodeLens previews in source files.

`Selector Shot: Validate Wiring` is read-only and reports whether wiring is complete, duplicated, or broken.

`Selector Shot: Enable And Validate` remains available as the workspace toggle plus validation command.

## Recommended Workspace Model

Selector Shot works best when the folder opened in VS Code is also the folder where capture runs.

Recommended default:

- standalone app: open the app root
- monorepo: open the package folder you are working in
- run `npx selector-shot-update` from that same folder
- keep capture output local at `.selector-shot`

That means the default setting is usually enough:

```json
{
  "selectorShot.dataGlob": ".selector-shot/**/*.json"
}
```

## Advanced Workspace Layouts

If metadata is intentionally written outside the currently opened workspace, then set `selectorShot.dataGlob` manually to match that layout.

Example:

- workspace opened at `packages/web-app`
- metadata written at repo root
- set `selectorShot.dataGlob` to `../../.selector-shot/**/*.json`

## Commands

- `Selector Shot: Refresh Index`
- `Selector Shot: Open Screenshot`
- `Selector Shot: Setup Project`
- `Selector Shot: Validate Wiring`
- `Selector Shot: Enable And Validate`
- `Selector Shot: Disable`

The extension also auto-refreshes when selector-shot metadata files change, and when VS Code regains focus or active editor changes.

## Roadmap

- Chain-aware locator captures: support locator-transforming chains so Selector Shot can safely attach visuals for `.first()`, `.last()`, `.nth()`, and then expand to `.filter()` plus chained `.locator()`. This work includes storing chain metadata instead of only the base selector and adding regressions to prove `first` and `nth` produce different captures.
- Accessibility selectors: add support for Playwright accessibility-first selectors such as `getByRole`, `getByLabel`, `getByText`, `getByTestId`, and related patterns.

## Settings

- `selectorShot.enabled` (default: `true`)
  - master toggle for CodeLens indexing and display in this workspace
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

`Selector Shot: Setup Project` warns that `@getulionm/selector-shot-playwright` could not be auto-installed:
1. Read the full command and Windows error text in the warning.
2. Run the suggested install command manually if needed.
3. Re-run `npx selector-shot-update`.

`Selector screenshot not found on disk`:
1. Re-run capture mode.
2. Refresh index.
3. Verify metadata `imagePath` exists on disk.
