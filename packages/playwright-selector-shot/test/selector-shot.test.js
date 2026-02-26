const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { selectorShot, installSelectorShot, wireSelectorShot } = require("../index");

test("installSelectorShot registers beforeEach and afterEach hooks", () => {
  const calls = [];
  const fakeTest = {
    beforeEach(fn) {
      calls.push(["beforeEach", typeof fn]);
    },
    afterEach(fn) {
      calls.push(["afterEach", typeof fn]);
    }
  };

  installSelectorShot(fakeTest, {});
  assert.deepEqual(calls, [
    ["beforeEach", "function"],
    ["afterEach", "function"]
  ]);
});

test("wireSelectorShot remains backward compatible", () => {
  const calls = [];
  const fakeTest = {
    beforeEach(fn) {
      calls.push(["beforeEach", typeof fn]);
    },
    afterEach(fn) {
      calls.push(["afterEach", typeof fn]);
    }
  };

  wireSelectorShot(fakeTest, {});
  assert.deepEqual(calls, [
    ["beforeEach", "function"],
    ["afterEach", "function"]
  ]);
});

test("selectorShot captures screenshot metadata for locator usage", async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "selector-shot-"));
  const hooks = selectorShot({
    outDir,
    selectorMarker: "selector-shot.test.js"
  });

  const page = {
    locator(selector) {
      return {
        first() {
          return {
            async waitFor() { },
            async scrollIntoViewIfNeeded() { },
            async screenshot({ path: imagePath }) {
              fs.writeFileSync(imagePath, `mock image for ${selector}`, "utf8");
            }
          };
        }
      };
    }
  };

  const testInfo = {
    title: "captures metadata",
    project: { name: "chromium" }
  };

  await hooks.beforeEach({ page }, testInfo);
  page.locator("text=More information");
  await hooks.afterEach({ page }, testInfo);

  const allFiles = fs.readdirSync(outDir, { recursive: true });
  const jsonFiles = allFiles.filter((name) => String(name).endsWith(".json"));
  const pngFiles = allFiles.filter((name) => String(name).endsWith(".png"));

  assert.equal(jsonFiles.length, 1);
  assert.equal(pngFiles.length, 1);

  const jsonPath = path.join(outDir, jsonFiles[0]);
  const meta = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  assert.equal(meta.selector, "text=More information");
  assert.equal(meta.status, "captured");
  assert.ok(fs.existsSync(meta.imagePath));
});

test("selectorShot retries screenshot capture before failing", async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "selector-shot-"));
  const hooks = selectorShot({
    outDir,
    selectorMarker: "selector-shot.test.js",
    captureRetries: 1,
    retryDelayMs: 1
  });

  let attempts = 0;
  const page = {
    locator() {
      return {
        first() {
          return {
            async waitFor() { },
            async scrollIntoViewIfNeeded() { },
            async screenshot() {
              attempts += 1;
              throw new Error("timeout while taking screenshot");
            }
          };
        }
      };
    }
  };

  const testInfo = {
    title: "retries before fail",
    project: { name: "chromium" }
  };

  await hooks.beforeEach({ page }, testInfo);
  page.locator("text=Retry me");
  await hooks.afterEach({ page }, testInfo);

  const allFiles = fs.readdirSync(outDir, { recursive: true });
  const jsonFiles = allFiles.filter((name) => String(name).endsWith(".json"));
  assert.equal(jsonFiles.length, 1);
  assert.equal(attempts, 2);

  const jsonPath = path.join(outDir, jsonFiles[0]);
  const meta = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  assert.equal(meta.status, "failed");
  assert.match(meta.error, /timeout while taking screenshot/);
});

test("selectorShot writes debug capture report when enabled", async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "selector-shot-"));
  const hooks = selectorShot({
    outDir,
    selectorMarker: "selector-shot.test.js",
    debugCapture: true
  });

  const page = {
    locator(selector) {
      return {
        first() {
          return {
            async waitFor() { },
            async scrollIntoViewIfNeeded() { },
            async screenshot({ path: imagePath }) {
              fs.writeFileSync(imagePath, `mock image for ${selector}`, "utf8");
            }
          };
        }
      };
    }
  };

  const testInfo = {
    title: "writes debug report",
    project: { name: "chromium" }
  };

  await hooks.beforeEach({ page }, testInfo);
  page.locator("text=Debug me");
  await hooks.afterEach({ page }, testInfo);

  const allFiles = fs.readdirSync(outDir, { recursive: true });
  const debugFiles = allFiles.filter((name) => String(name).endsWith("_selector-shot-debug.json"));
  assert.equal(debugFiles.length, 1);

  const debugPath = path.join(outDir, debugFiles[0]);
  const report = JSON.parse(fs.readFileSync(debugPath, "utf8"));
  assert.equal(report.testTitle, "writes debug report");
  assert.equal(report.capturedSelectors, 1);
  assert.equal(report.entries.length, 1);
  assert.equal(report.entries[0].status, "captured");
});

test("selectorShot can capture on locator usage before afterEach", async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "selector-shot-"));
  const hooks = selectorShot({
    outDir,
    selectorMarker: "selector-shot.test.js",
    captureStrategy: "onUse",
    maxAfterEachMs: 1
  });

  const page = {
    locator(selector) {
      return {
        async fill() { },
        first() {
          return {
            async waitFor() { },
            async scrollIntoViewIfNeeded() { },
            async screenshot({ path: imagePath }) {
              fs.writeFileSync(imagePath, `mock image for ${selector}`, "utf8");
            }
          };
        }
      };
    }
  };

  const testInfo = {
    title: "captures on use",
    project: { name: "chromium" }
  };

  await hooks.beforeEach({ page }, testInfo);
  await page.locator("text=Capture on use").fill("x");
  await hooks.afterEach({ page }, testInfo);

  const allFiles = fs.readdirSync(outDir, { recursive: true });
  const jsonFiles = allFiles.filter((name) => String(name).endsWith(".json"));
  assert.equal(jsonFiles.length, 1);

  const jsonPath = path.join(outDir, jsonFiles[0]);
  const meta = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  assert.equal(meta.status, "captured");
  assert.equal(meta.selector, "text=Capture on use");
});
