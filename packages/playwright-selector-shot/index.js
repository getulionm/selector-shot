const fs = require("node:fs");
const path = require("node:path");

const LOCATOR_CALLSITE_RE = /\((.+):(\d+):(\d+)\)$/;
const LOCATOR_CALLSITE_ALT_RE = /at (.+):(\d+):(\d+)$/;

function safeName(input) {
  return String(input).replace(/[^a-zA-Z0-9-_]+/g, "_").slice(0, 80) || "item";
}

function parseCallsite(stack, options = {}) {
  if (!stack) {
    return null;
  }

  const marker = options.marker;
  const ignoredPaths = options.ignoredPaths || [];
  const lines = stack.split("\n");
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (marker && !line.includes(marker)) {
      continue;
    }

    const match = line.match(LOCATOR_CALLSITE_RE) || line.match(LOCATOR_CALLSITE_ALT_RE);
    if (!match) {
      continue;
    }

    const [, filePath, lineNumber, columnNumber] = match;
    if (!filePath || filePath.startsWith("node:")) {
      continue;
    }

    const resolved = path.resolve(filePath);
    const isIgnored = ignoredPaths.some((ignoredPath) => {
      return resolved.toLowerCase() === path.resolve(ignoredPath).toLowerCase();
    });
    if (isIgnored) {
      continue;
    }

    return {
      filePath: resolved,
      line: Number(lineNumber),
      column: Number(columnNumber)
    };
  }

  return null;
}

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readPositiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function readNonNegativeInt(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

function readCaptureStrategy(value, fallback = "afterEach") {
  const allowed = new Set(["afterEach", "onUse", "hybrid"]);
  if (typeof value === "string" && allowed.has(value)) {
    return value;
  }
  return fallback;
}

function readBool(value, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") {
      return true;
    }
    if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") {
      return false;
    }
  }
  return fallback;
}

async function captureSelectorScreenshot(page, selector, imagePath, options) {
  const locator = page.locator(selector).first();
  let lastError = null;
  const startedAtMs = Date.now();
  const debug = {
    selector: String(selector),
    startedAt: new Date(startedAtMs).toISOString(),
    attempts: []
  };

  for (let attempt = 0; attempt <= options.captureRetries; attempt += 1) {
    const attemptStartedAtMs = Date.now();
    const attemptDebug = {
      attempt: attempt + 1,
      startedAt: new Date(attemptStartedAtMs).toISOString()
    };
    try {
      if (options.skipMissingSelectors) {
        const attachedQuickStart = Date.now();
        await locator.waitFor({ state: "attached", timeout: options.missingSelectorTimeoutMs });
        attemptDebug.waitAttachedQuickMs = Date.now() - attachedQuickStart;
      }

      const attachedStart = Date.now();
      await locator.waitFor({ state: "attached", timeout: options.preCaptureWaitMs });
      attemptDebug.waitAttachedMs = Date.now() - attachedStart;

      const visibleStart = Date.now();
      await locator.waitFor({ state: "visible", timeout: options.preCaptureWaitMs });
      attemptDebug.waitVisibleMs = Date.now() - visibleStart;

      const scrollStart = Date.now();
      await locator.scrollIntoViewIfNeeded({ timeout: options.preCaptureWaitMs });
      attemptDebug.scrollIntoViewMs = Date.now() - scrollStart;

      const screenshotStart = Date.now();
      await locator.screenshot({
        path: imagePath,
        animations: "disabled",
        timeout: options.captureTimeoutMs
      });
      attemptDebug.screenshotMs = Date.now() - screenshotStart;
      attemptDebug.status = "captured";
      attemptDebug.durationMs = Date.now() - attemptStartedAtMs;
      debug.attempts.push(attemptDebug);
      debug.status = "captured";
      debug.durationMs = Date.now() - startedAtMs;
      return;
    } catch (error) {
      lastError = error;
      attemptDebug.status = "failed";
      attemptDebug.durationMs = Date.now() - attemptStartedAtMs;
      attemptDebug.error = error && error.message ? error.message : String(error);
      debug.attempts.push(attemptDebug);
      if (attempt < options.captureRetries) {
        await sleep(options.retryDelayMs * (attempt + 1));
      }
    }
  }

  debug.status = "failed";
  debug.durationMs = Date.now() - startedAtMs;
  if (lastError && typeof lastError === "object") {
    lastError.selectorShotDebug = debug;
  }
  throw lastError;
}

function selectorShot(options = {}) {
  const outDir = options.outDir || ".selector-shot";
  const selectorMarker = options.selectorMarker || ".locator (";
  const maxPerTest = options.maxPerTest || 50;
  const captureStrategy = readCaptureStrategy(options.captureStrategy, "afterEach");
  const captureTimeoutMs = readPositiveInt(options.captureTimeoutMs, 2500);
  const preCaptureWaitMs = readPositiveInt(options.preCaptureWaitMs, 750);
  const captureRetries = readNonNegativeInt(options.captureRetries, 0);
  const retryDelayMs = readPositiveInt(options.retryDelayMs, 200);
  const maxAfterEachMs = readPositiveInt(options.maxAfterEachMs, 8000);
  const skipMissingSelectors = readBool(options.skipMissingSelectors, true);
  const missingSelectorTimeoutMs = readPositiveInt(options.missingSelectorTimeoutMs, 300);
  const debugCapture = readBool(options.debugCapture, false) || readBool(process.env.SELECTOR_SHOT_DEBUG, false);
  const debugConsole = readBool(options.debugConsole, false) || readBool(process.env.SELECTOR_SHOT_DEBUG_CONSOLE, false);

  async function captureRecord(page, state, item, runDir, debugReport, reason) {
    const key = `${item.source.filePath}:${item.source.line}:${item.source.column}`;
    if (state.finalizedKeys.has(key)) {
      return;
    }

    const fileBase = `${String(item.id).padStart(3, "0")}-${safeName(item.selector)}`;
    const imagePath = path.join(runDir, `${fileBase}.png`);
    const metaPath = path.join(runDir, `${fileBase}.json`);
    const meta = {
      selector: item.selector,
      testTitle: state.testTitle,
      project: state.projectName,
      source: item.source,
      imagePath: imagePath,
      createdAt: new Date().toISOString()
    };
    const debugEntry = {
      selector: item.selector,
      source: item.source,
      metaPath,
      imagePath,
      reason
    };

    try {
      await captureSelectorScreenshot(page, item.selector, imagePath, {
        captureTimeoutMs: state.captureTimeoutMs,
        preCaptureWaitMs: state.preCaptureWaitMs,
        captureRetries: state.captureRetries,
        retryDelayMs: state.retryDelayMs,
        skipMissingSelectors: state.skipMissingSelectors,
        missingSelectorTimeoutMs: state.missingSelectorTimeoutMs
      });
      meta.status = "captured";
      debugEntry.status = "captured";
    } catch (error) {
      meta.status = "failed";
      meta.error = error && error.message ? error.message : String(error);
      debugEntry.status = "failed";
      debugEntry.error = meta.error;
      if (error && typeof error === "object" && error.selectorShotDebug) {
        debugEntry.capture = error.selectorShotDebug;
      }
      if (state.debugConsole) {
        console.warn(
          `[selector-shot] capture failed: ${item.source.filePath}:${item.source.line}:${item.source.column} selector="${item.selector}" error="${meta.error}"`
        );
      }
    }

    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf8");
    if (state.debugCapture) {
      debugReport.entries.push(debugEntry);
    }
    state.finalizedKeys.add(key);
  }

  function wrapLocatorForOnUse(locator, record, state, debugReport) {
    const checkpointMethods = new Set([
      "click",
      "dblclick",
      "tap",
      "fill",
      "press",
      "check",
      "uncheck",
      "selectOption",
      "setInputFiles",
      "clear",
      "focus",
      "hover",
      "dragTo"
    ]);
    const captureBeforeMethods = new Set([
      "click",
      "dblclick",
      "tap",
      "press",
      "check",
      "uncheck",
      "selectOption",
      "setInputFiles",
      "dragTo"
    ]);

    for (const method of checkpointMethods) {
      const original = locator[method];
      if (typeof original !== "function") {
        continue;
      }

      locator[method] = function wrappedLocatorMethod(...args) {
        const captureBeforeAction = captureBeforeMethods.has(method);
        const runCapture = async (reasonSuffix) => {
          await captureRecord(state.page, state, record, state.runDir, debugReport, `onUse:${method}:${reasonSuffix}`);
        };

        if (captureBeforeAction) {
          const beforeCapture = runCapture("before");
          const callOriginal = () => original.apply(locator, args);
          if (beforeCapture && typeof beforeCapture.then === "function") {
            return Promise.resolve(beforeCapture).then(callOriginal);
          }
          return callOriginal();
        }

        const result = original.apply(locator, args);

        if (result && typeof result.then === "function") {
          return Promise.resolve(result).finally(async () => {
            await runCapture("after");
          });
        }

        void runCapture("after");
        return result;
      };
    }

    return locator;
  }

  return {
    async beforeEach({ page }, testInfo) {
      const originalLocator = page.locator.bind(page);
      const records = [];
      const runStamp = process.env.SELECTOR_SHOT_RUN_ID || nowStamp();
      const testName = safeName(`${testInfo.project.name}-${testInfo.title}`);
      const runDir = path.resolve(outDir, runStamp, testName);
      ensureDir(runDir);

      const debugReport = {
        testTitle: testInfo.title,
        project: testInfo.project.name,
        startedAt: new Date().toISOString(),
        options: {
          captureStrategy,
          captureTimeoutMs,
          preCaptureWaitMs,
          captureRetries,
          retryDelayMs,
          maxAfterEachMs,
          skipMissingSelectors,
          missingSelectorTimeoutMs
        },
        dedupedSelectors: 0,
        capturedSelectors: 0,
        entries: []
      };
      let sequence = 0;

      page.locator = function patchedLocator(selector, locatorOptions) {
        const stack = new Error().stack || "";
        const source =
          parseCallsite(stack, { marker: selectorMarker, ignoredPaths: [__filename] }) ||
          parseCallsite(stack, { ignoredPaths: [__filename] });
        sequence += 1;

        if (source) {
          const record = {
            id: sequence,
            selector: String(selector),
            source
          };
          records.push(record);

          if (captureStrategy === "onUse" || captureStrategy === "hybrid") {
            const locator = originalLocator(selector, locatorOptions);
            return wrapLocatorForOnUse(locator, record, testInfo._selectorShot, debugReport);
          }
        }

        return originalLocator(selector, locatorOptions);
      };

      testInfo._selectorShot = {
        page,
        testTitle: testInfo.title,
        projectName: testInfo.project.name,
        runDir,
        debugReport,
        finalizedKeys: new Set(),
        records,
        originalLocator,
        outDir,
        maxPerTest,
        captureStrategy,
        captureTimeoutMs,
        preCaptureWaitMs,
        captureRetries,
        retryDelayMs,
        maxAfterEachMs,
        skipMissingSelectors,
        missingSelectorTimeoutMs,
        debugCapture,
        debugConsole
      };
    },

    async afterEach({ page }, testInfo) {
      const state = testInfo._selectorShot;
      if (!state) {
        return;
      }

      page.locator = state.originalLocator;

      const afterEachStartedAtMs = Date.now();
      const runDir = state.runDir;
      const debugReport = state.debugReport;

      const seen = new Set();
      const selected = [];
      for (const item of state.records) {
        const dedupe = `${item.source.filePath}:${item.source.line}:${item.source.column}`;
        if (seen.has(dedupe)) {
          continue;
        }
        seen.add(dedupe);
        selected.push(item);
      }

      const limited = selected.slice(0, state.maxPerTest);
      debugReport.dedupedSelectors = selected.length;
      debugReport.capturedSelectors = limited.length;

      if (state.captureStrategy === "afterEach" || state.captureStrategy === "hybrid") {
        for (const item of limited) {
          const elapsedMs = Date.now() - afterEachStartedAtMs;
          if (elapsedMs >= state.maxAfterEachMs) {
            if (state.debugCapture) {
              debugReport.budgetExceeded = true;
              debugReport.budgetExceededAtMs = elapsedMs;
            }
            break;
          }
          await captureRecord(page, state, item, runDir, debugReport, "afterEach");
        }
      }

      if (state.debugCapture) {
        debugReport.afterEachDurationMs = Date.now() - afterEachStartedAtMs;
        const debugPath = path.join(runDir, "_selector-shot-debug.json");
        fs.writeFileSync(debugPath, JSON.stringify(debugReport, null, 2), "utf8");
      }
    }
  };
}

function installSelectorShot(test, options = {}) {
  const hooks = selectorShot(options);
  test.beforeEach(hooks.beforeEach);
  test.afterEach(hooks.afterEach);
}

function wireSelectorShot(test, options = {}) {
  installSelectorShot(test, options);
}

module.exports = {
  selectorShot,
  installSelectorShot,
  wireSelectorShot
};
