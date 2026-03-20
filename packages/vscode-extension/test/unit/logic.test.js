const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  buildSelectorShotInstallCommand,
  lineContainsConcreteSelectorText,
  codeLensTitleForItem,
  formatCaptureTime,
  normalizeCapturedSourcePath
} = require("../../dist/logic.js");

test("matches selector object member references", () => {
  const line = "await page.locator(selectors.birthdate).fill(contact.birthdate);";
  assert.equal(lineContainsConcreteSelectorText(line), true);
});

test("matches string literal selectors", () => {
  const line = "await page.locator('#id').fill(value);";
  assert.equal(lineContainsConcreteSelectorText(line), true);
});

test("matches variable selectors", () => {
  const line = "await page.locator(selector1).fill(value);";
  assert.equal(lineContainsConcreteSelectorText(line), true);
});

test("failed title includes failure prefix and capture time", () => {
  const title = codeLensTitleForItem({
    status: "failed",
    createdAt: "2026-02-26T16:10:31.248Z"
  });
  assert.match(title, /^Failed selector screenshot capture \(.+\)$/);
});

test("success title includes open prefix and capture time", () => {
  const title = codeLensTitleForItem({
    status: "captured",
    createdAt: "2026-02-26T16:10:31.248Z"
  });
  assert.match(title, /^Open selector screenshot \(.+\)$/);
});

test("formatCaptureTime returns fallback for empty value", () => {
  assert.equal(formatCaptureTime(""), "unknown time");
});

test("normalizes malformed Windows capture source paths", () => {
  if (process.platform !== "win32") {
    assert.equal(normalizeCapturedSourcePath("/tmp/example.spec.js"), path.normalize("/tmp/example.spec.js"));
    return;
  }

  assert.equal(
    normalizeCapturedSourcePath("C:\\C:\\Users\\getul\\project\\tests\\example.spec.js"),
    path.normalize("C:\\Users\\getul\\project\\tests\\example.spec.js")
  );
});

test("prefers packageManager field when choosing install command", () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "selector-shot-vscode-"));
  const command = buildSelectorShotInstallCommand(workspaceRoot, { packageManager: "pnpm@9.0.0" });

  assert.equal(command.packageManager, "pnpm");
  assert.deepEqual(command.args, ["add", "-D", "@getulionm/selector-shot-playwright"]);
  assert.equal(command.manualCommand, "pnpm add -D @getulionm/selector-shot-playwright");
});

test("falls back to yarn lockfile when packageManager field is absent", () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "selector-shot-vscode-"));
  fs.writeFileSync(path.join(workspaceRoot, "yarn.lock"), "");

  const command = buildSelectorShotInstallCommand(workspaceRoot);

  assert.equal(command.packageManager, "yarn");
  assert.deepEqual(command.args, ["add", "-D", "@getulionm/selector-shot-playwright"]);
  assert.equal(command.manualCommand, "yarn add -D @getulionm/selector-shot-playwright");
});

test("uses bun install flags for bun workspaces", () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "selector-shot-vscode-"));
  fs.writeFileSync(path.join(workspaceRoot, "bun.lock"), "");

  const command = buildSelectorShotInstallCommand(workspaceRoot);

  assert.equal(command.packageManager, "bun");
  assert.deepEqual(command.args, ["add", "-d", "@getulionm/selector-shot-playwright"]);
  assert.equal(command.manualCommand, "bun add -d @getulionm/selector-shot-playwright");
});
