const test = require("node:test");
const assert = require("node:assert/strict");

const {
  lineContainsConcreteSelectorText,
  codeLensTitleForItem,
  formatCaptureTime
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
