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
3. Select `packages/vscode-extension/selector-shot-vscode-extension-0.0.4.vsix`

## Client Setup (Recommended)

In the client repo:
1. Install this extension from VSIX (or Marketplace).
2. Open the app or package folder you want to work in.
2. Run command: `Selector Shot: Setup Project (Validate Wiring)`
3. Run:
```bash
npx selector-shot-update
```

If your test command is not `npm test`, pass it explicitly:
```bash
npx selector-shot-update npm run test:e2e
```

`Selector Shot: Setup Project` performs bootstrap automatically:
- installs `@getulionm/selector-shot-playwright` as a dev dependency when missing
- auto-wires existing custom Playwright fixture files imported by specs (`base.extend(...)`)
- creates `tests/setup.selector-shot.ts` (or `.js` if no TypeScript specs are found)
- updates spec imports to use the setup file for `test`
- adds `test:selector-shot-update` script to `package.json` if missing

`Selector Shot: Enable And Validate` remains available as the workspace toggle plus bootstrap gate.

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
- `Selector Shot: Setup Project (Validate Wiring)`
- `Selector Shot: Enable And Validate`
- `Selector Shot: Disable`

The extension also auto-refreshes when selector-shot metadata files change, and when VS Code regains focus or active editor changes.

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

`Selector Shot: Setup Project (Validate Wiring)` warns that `@getulionm/selector-shot-playwright` could not be auto-installed:
1. Read the full command and Windows error text in the warning.
2. Run the suggested install command manually if needed.
3. Re-run `npx selector-shot-update`.

`Selector screenshot not found on disk`:
1. Re-run capture mode.
2. Refresh index.
3. Verify metadata `imagePath` exists on disk.
