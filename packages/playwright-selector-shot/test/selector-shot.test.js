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

test("selectorShot captures before click when locator disappears after navigation", async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "selector-shot-"));
  const hooks = selectorShot({
    outDir,
    selectorMarker: "selector-shot.test.js",
    captureStrategy: "onUse",
    missingSelectorTimeoutMs: 1,
    preCaptureWaitMs: 1,
    captureTimeoutMs: 10
  });

  let navigated = false;
  const page = {
    locator(selector) {
      return {
        async click() {
          navigated = true;
        },
        first() {
          return {
            async waitFor() {
              if (navigated) {
                throw new Error("selector missing after navigation");
              }
            },
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
    title: "captures before click navigation",
    project: { name: "chromium" }
  };

  await hooks.beforeEach({ page }, testInfo);
  await page.locator("#signup").click();
  await hooks.afterEach({ page }, testInfo);

  const allFiles = fs.readdirSync(outDir, { recursive: true });
  const jsonFiles = allFiles.filter((name) => String(name).endsWith(".json"));
  assert.equal(jsonFiles.length, 1);

  const jsonPath = path.join(outDir, jsonFiles[0]);
  const meta = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  assert.equal(meta.status, "captured");
  assert.equal(meta.selector, "#signup");
});

test("selectorShot can capture locator assertions via _expect when enabled", async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "selector-shot-"));
  const hooks = selectorShot({
    outDir,
    selectorMarker: "selector-shot.test.js",
    captureStrategy: "onUse",
    captureAssertions: true
  });

  const page = {
    locator(selector) {
      return {
        async _expect() {
          return { matches: true };
        },
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
    title: "captures assertions",
    project: { name: "chromium" }
  };

  await hooks.beforeEach({ page }, testInfo);
  await page.locator("#assertion-target")._expect("to.be.visible");
  await hooks.afterEach({ page }, testInfo);

  const allFiles = fs.readdirSync(outDir, { recursive: true });
  const jsonFiles = allFiles.filter((name) => String(name).endsWith(".json"));
  assert.equal(jsonFiles.length, 1);

  const jsonPath = path.join(outDir, jsonFiles[0]);
  const meta = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  assert.equal(meta.status, "captured");
  assert.equal(meta.selector, "#assertion-target");
});

test("selectorShot falls back to afterEach when captureStrategy is invalid", async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "selector-shot-"));
  const hooks = selectorShot({
    outDir,
    selectorMarker: "selector-shot.test.js",
    captureStrategy: "unsupported-mode"
  });

  let fillCalls = 0;
  const page = {
    locator(selector) {
      return {
        async fill() {
          fillCalls += 1;
        },
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
    title: "invalid strategy falls back",
    project: { name: "chromium" }
  };

  await hooks.beforeEach({ page }, testInfo);
  await page.locator("#fallback-strategy").fill("hello");
  const filesBeforeAfterEach = fs.readdirSync(outDir, { recursive: true }).filter((name) => String(name).endsWith(".json"));
  assert.equal(filesBeforeAfterEach.length, 0);

  await hooks.afterEach({ page }, testInfo);

  const jsonFiles = fs.readdirSync(outDir, { recursive: true }).filter((name) => String(name).endsWith(".json"));
  assert.equal(fillCalls, 1);
  assert.equal(jsonFiles.length, 1);
});

test("selectorShot coerces string and env options for debug and retries", async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "selector-shot-"));
  process.env.SELECTOR_SHOT_DEBUG = "1";

  try {
    const hooks = selectorShot({
      outDir,
      selectorMarker: "selector-shot.test.js",
      captureRetries: "1",
      retryDelayMs: "1",
      skipMissingSelectors: "false",
      debugConsole: "true"
    });

    let attachedWaits = 0;
    let screenshotAttempts = 0;
    const page = {
      locator() {
        return {
          first() {
            return {
              async waitFor({ state }) {
                if (state === "attached") {
                  attachedWaits += 1;
                }
              },
              async scrollIntoViewIfNeeded() { },
              async screenshot() {
                screenshotAttempts += 1;
                if (screenshotAttempts === 1) {
                  throw new Error("first attempt failed");
                }
              }
            };
          }
        };
      }
    };

    const testInfo = {
      title: "env debug and string coercion",
      project: { name: "chromium" }
    };

    await hooks.beforeEach({ page }, testInfo);
    page.locator("#coerced-options");
    await hooks.afterEach({ page }, testInfo);

    const allFiles = fs.readdirSync(outDir, { recursive: true });
    const debugFiles = allFiles.filter((name) => String(name).endsWith("_selector-shot-debug.json"));
    assert.equal(debugFiles.length, 1);
    assert.equal(screenshotAttempts, 2);
    assert.equal(attachedWaits, 2);

    const debugPath = path.join(outDir, debugFiles[0]);
    const report = JSON.parse(fs.readFileSync(debugPath, "utf8"));
    assert.equal(report.options.captureRetries, 1);
    assert.equal(report.options.retryDelayMs, 1);
    assert.equal(report.options.skipMissingSelectors, false);
  } finally {
    delete process.env.SELECTOR_SHOT_DEBUG;
  }
});

test("selectorShot enforces maxPerTest after deduping callsites", async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "selector-shot-"));
  const hooks = selectorShot({
    outDir,
    selectorMarker: "selector-shot.test.js",
    maxPerTest: 1
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
    title: "max per test",
    project: { name: "chromium" }
  };

  await hooks.beforeEach({ page }, testInfo);
  page.locator("#first-limited");
  page.locator("#second-limited");
  await hooks.afterEach({ page }, testInfo);

  const allFiles = fs.readdirSync(outDir, { recursive: true });
  const jsonFiles = allFiles.filter((name) => String(name).endsWith(".json"));
  assert.equal(jsonFiles.length, 1);

  const meta = JSON.parse(fs.readFileSync(path.join(outDir, jsonFiles[0]), "utf8"));
  assert.equal(meta.selector, "#first-limited");
});

test("selectorShot does not capture the same selector twice in hybrid mode", async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "selector-shot-"));
  const hooks = selectorShot({
    outDir,
    selectorMarker: "selector-shot.test.js",
    captureStrategy: "hybrid"
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
    title: "hybrid dedupe",
    project: { name: "chromium" }
  };

  await hooks.beforeEach({ page }, testInfo);
  await page.locator("#hybrid-target").fill("value");
  await hooks.afterEach({ page }, testInfo);

  const jsonFiles = fs.readdirSync(outDir, { recursive: true }).filter((name) => String(name).endsWith(".json"));
  assert.equal(jsonFiles.length, 1);
});

test("selectorShot stops afterEach capture when the time budget is exhausted", async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "selector-shot-"));
  const hooks = selectorShot({
    outDir,
    selectorMarker: "selector-shot.test.js",
    maxAfterEachMs: 1,
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
              await new Promise((resolve) => setTimeout(resolve, 5));
              fs.writeFileSync(imagePath, `mock image for ${selector}`, "utf8");
            }
          };
        }
      };
    }
  };

  const testInfo = {
    title: "afterEach budget",
    project: { name: "chromium" }
  };

  await hooks.beforeEach({ page }, testInfo);
  page.locator("#budget-one");
  page.locator("#budget-two");
  await hooks.afterEach({ page }, testInfo);

  const allFiles = fs.readdirSync(outDir, { recursive: true });
  const jsonFiles = allFiles.filter((name) => String(name).endsWith(".json") && !String(name).endsWith("_selector-shot-debug.json"));
  const debugFile = allFiles.find((name) => String(name).endsWith("_selector-shot-debug.json"));
  assert.equal(jsonFiles.length, 1);
  assert.ok(debugFile);

  const report = JSON.parse(fs.readFileSync(path.join(outDir, debugFile), "utf8"));
  assert.equal(report.budgetExceeded, true);
});
