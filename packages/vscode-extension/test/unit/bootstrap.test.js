const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  bootstrapWorkspace,
  ensureSelectorShotDependency,
  validateWorkspace
} = require("../../dist/bootstrap.js");

function createWorkspace(files) {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "selector-shot-bootstrap-"));

  for (const [relativePath, contents] of Object.entries(files)) {
    const absolutePath = path.join(workspaceRoot, relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, contents, "utf8");
  }

  return workspaceRoot;
}

function readFile(workspaceRoot, relativePath) {
  return fs.readFileSync(path.join(workspaceRoot, relativePath), "utf8");
}

function installHelperDependency(workspaceRoot) {
  const packageJsonPath = path.join(workspaceRoot, "package.json");
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  packageJson.devDependencies = packageJson.devDependencies || {};
  packageJson.devDependencies["@getulionm/selector-shot-playwright"] = "^0.0.6";
  fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");
  return { installed: true };
}

function failHelperInstall() {
  return {
    installed: false,
    note: "Could not auto-install helper package. Run npm install -D @getulionm/selector-shot-playwright."
  };
}

test("fails early when @playwright/test is missing and does not write setup files", () => {
  const workspaceRoot = createWorkspace({
    "package.json": JSON.stringify({ name: "client-repo", version: "1.0.0" }, null, 2),
    "tests/example.spec.js": 'const { test, expect } = require("@playwright/test");\n'
  });

  const result = bootstrapWorkspace(workspaceRoot);

  assert.equal(result.status, "failed");
  assert.match(result.summary, /@playwright\/test is not installed/i);
  assert.equal(fs.existsSync(path.join(workspaceRoot, "tests", "setup.selector-shot.js")), false);
  assert.equal(readFile(workspaceRoot, "tests/example.spec.js"), 'const { test, expect } = require("@playwright/test");\n');
});

test("patches a minimal CommonJS Playwright repo with one shared setup file and source-path-only spec changes", () => {
  const workspaceRoot = createWorkspace({
    "package.json": JSON.stringify(
      {
        name: "client-repo",
        version: "1.0.0",
        devDependencies: {
          "@playwright/test": "^1.52.0"
        }
      },
      null,
      2
    ),
    "tests/example.spec.js": [
      'const { test, expect } = require("@playwright/test");',
      "",
      'test("works", async ({ page }) => {',
      '  await expect(page.locator("[data-testid=\'hero\']")).toBeVisible();',
      "});",
      ""
    ].join("\n")
  });

  const beforeValidation = validateWorkspace(workspaceRoot);
  assert.equal(beforeValidation.status, "broken");
  assert.match(beforeValidation.summary, /still imports test directly/i);

  const result = bootstrapWorkspace(workspaceRoot, {
    ensureDependency: installHelperDependency
  });

  assert.equal(result.status, "success");
  assert.equal(result.installedDependency, true);
  assert.match(result.summary, /created 1 shared setup file/i);
  assert.match(result.summary, /patched 1 test entry point/i);

  const packageJson = JSON.parse(readFile(workspaceRoot, "package.json"));
  assert.equal(packageJson.scripts, undefined);

  const setupContents = readFile(workspaceRoot, "tests/setup.selector-shot.js");
  assert.match(setupContents, /const playwright = require\("@playwright\/test"\);/);
  assert.match(setupContents, /const \{ installSelectorShot \} = require\("@getulionm\/selector-shot-playwright"\);/);
  assert.match(setupContents, /const \{ test, expect \} = playwright;/);
  assert.match(setupContents, /module\.exports = \{ \.\.\.playwright, test, expect \};/);

  const specContents = readFile(workspaceRoot, "tests/example.spec.js");
  assert.equal(specContents.includes('require("@playwright/test")'), false);
  assert.equal(specContents.includes('require("./setup.selector-shot")'), true);

  const afterValidation = validateWorkspace(workspaceRoot);
  assert.equal(afterValidation.status, "complete");
});

test("creates one shared setup file for multiple direct-import specs", () => {
  const workspaceRoot = createWorkspace({
    "package.json": JSON.stringify(
      {
        name: "client-repo",
        version: "1.0.0",
        devDependencies: {
          "@playwright/test": "^1.52.0"
        }
      },
      null,
      2
    ),
    "tests/e2e/login.spec.js": [
      'const { test, expect } = require("@playwright/test");',
      "",
      'test("login", async ({ page }) => {',
      '  await expect(page.locator("[data-testid=\'login\']")).toBeVisible();',
      "});",
      ""
    ].join("\n"),
    "tests/e2e/logout.spec.js": [
      'const { test, expect } = require("@playwright/test");',
      "",
      'test("logout", async ({ page }) => {',
      '  await expect(page.locator("[data-testid=\'logout\']")).toBeVisible();',
      "});",
      ""
    ].join("\n")
  });

  const result = bootstrapWorkspace(workspaceRoot, {
    ensureDependency: installHelperDependency
  });

  assert.equal(result.status, "success");
  assert.match(result.summary, /created 1 shared setup file/i);
  assert.match(result.summary, /patched 2 test entry points/i);
  assert.equal(fs.existsSync(path.join(workspaceRoot, "tests", "e2e", "setup.selector-shot.js")), true);

  const firstSpec = readFile(workspaceRoot, "tests/e2e/login.spec.js");
  const secondSpec = readFile(workspaceRoot, "tests/e2e/logout.spec.js");
  assert.equal(firstSpec.includes('require("./setup.selector-shot")'), true);
  assert.equal(secondSpec.includes('require("./setup.selector-shot")'), true);

  const validation = validateWorkspace(workspaceRoot);
  assert.equal(validation.status, "complete");
});

test("patches a shared custom fixture without creating an extra setup file", () => {
  const workspaceRoot = createWorkspace({
    "package.json": JSON.stringify(
      {
        name: "client-repo",
        version: "1.0.0",
        devDependencies: {
          "@playwright/test": "^1.52.0",
          "@getulionm/selector-shot-playwright": "^0.0.6"
        }
      },
      null,
      2
    ),
    "tests/fixtures/base.fixture.ts": [
      'import { test as base, expect } from "@playwright/test";',
      "",
      "export const test = base.extend({",
      "  appName: async ({}, use) => {",
      '    await use("selector-shot");',
      "  }",
      "});",
      "",
      "export { expect };",
      ""
    ].join("\n"),
    "tests/playwright/custom-fixture.spec.ts": [
      'import { test, expect } from "../fixtures/base.fixture";',
      "",
      'test("works", async ({ page }) => {',
      '  await expect(page.locator("button[data-testid=\'save\']")).toBeVisible();',
      "});",
      ""
    ].join("\n")
  });

  const result = bootstrapWorkspace(workspaceRoot);

  assert.equal(result.status, "success");
  assert.equal(fs.existsSync(path.join(workspaceRoot, "tests", "playwright", "setup.selector-shot.ts")), false);
  assert.match(result.summary, /patched 1 shared fixture/i);

  const fixtureContents = readFile(workspaceRoot, "tests/fixtures/base.fixture.ts");
  assert.match(fixtureContents, /import \{ installSelectorShot \} from "@getulionm\/selector-shot-playwright";/);
  assert.match(fixtureContents, /installSelectorShot\(test, \{/);

  const specContents = readFile(workspaceRoot, "tests/playwright/custom-fixture.spec.ts");
  assert.equal(specContents.includes("setup.selector-shot"), false);

  const validation = validateWorkspace(workspaceRoot);
  assert.equal(validation.status, "complete");
});

test("fails cleanly when helper auto-install fails and leaves the repo unchanged", () => {
  const workspaceRoot = createWorkspace({
    "package.json": JSON.stringify(
      {
        name: "client-repo",
        version: "1.0.0",
        devDependencies: {
          "@playwright/test": "^1.52.0"
        }
      },
      null,
      2
    ),
    "tests/example.spec.js": [
      'const { test, expect } = require("@playwright/test");',
      "",
      'test("works", async ({ page }) => {',
      '  await expect(page.locator("[data-testid=\'hero\']")).toBeVisible();',
      "});",
      ""
    ].join("\n")
  });

  const originalPackageJson = readFile(workspaceRoot, "package.json");
  const originalSpec = readFile(workspaceRoot, "tests/example.spec.js");

  const result = bootstrapWorkspace(workspaceRoot, {
    ensureDependency: failHelperInstall
  });

  assert.equal(result.status, "failed");
  assert.match(result.summary, /Could not auto-install helper package/i);
  assert.equal(fs.existsSync(path.join(workspaceRoot, "tests", "setup.selector-shot.js")), false);
  assert.equal(readFile(workspaceRoot, "package.json"), originalPackageJson);
  assert.equal(readFile(workspaceRoot, "tests/example.spec.js"), originalSpec);
});

test("uses shell-backed install execution for Windows package-manager commands", () => {
  const workspaceRoot = createWorkspace({
    "package.json": JSON.stringify(
      {
        name: "client-repo",
        version: "1.0.0",
        devDependencies: {
          "@playwright/test": "^1.52.0"
        }
      },
      null,
      2
    )
  });

  let captured = null;
  const result = ensureSelectorShotDependency(
    workspaceRoot,
    JSON.parse(readFile(workspaceRoot, "package.json")),
    (command, args, options) => {
      captured = { command, args, options };
      return {
        status: 0,
        stdout: "",
        stderr: ""
      };
    }
  );

  assert.equal(result.installed, true);
  assert.ok(captured);
  assert.equal(captured.options.cwd, workspaceRoot);
  assert.equal(captured.options.encoding, "utf8");
  assert.equal(captured.options.shell, process.platform === "win32");
});

test("patches a TypeScript ESM namespace-style direct spec with a shared setup file", () => {
  const workspaceRoot = createWorkspace({
    "package.json": JSON.stringify(
      {
        name: "client-repo",
        version: "1.0.0",
        type: "module",
        devDependencies: {
          "@playwright/test": "^1.52.0"
        }
      },
      null,
      2
    ),
    "tests/example.spec.ts": [
      'import * as playwright from "@playwright/test";',
      "",
      'playwright.test("works", async ({ page }) => {',
      '  await playwright.expect(page.locator("[data-testid=\'hero\']")).toBeVisible();',
      "});",
      ""
    ].join("\n")
  });

  const result = bootstrapWorkspace(workspaceRoot, {
    ensureDependency: installHelperDependency
  });

  assert.equal(result.status, "success");
  assert.match(result.summary, /created 1 shared setup file/i);
  assert.match(result.summary, /patched 1 test entry point/i);

  const setupContents = readFile(workspaceRoot, "tests/setup.selector-shot.ts");
  assert.match(setupContents, /import \* as playwright from "@playwright\/test";/);
  assert.match(setupContents, /import \{ installSelectorShot \} from "@getulionm\/selector-shot-playwright";/);
  assert.match(setupContents, /export \* from "@playwright\/test";/);
  assert.match(setupContents, /export \{ test, expect \};/);

  const specContents = readFile(workspaceRoot, "tests/example.spec.ts");
  assert.equal(specContents.includes('from "@playwright/test"'), false);
  assert.equal(specContents.includes('from "./setup.selector-shot"'), true);

  const validation = validateWorkspace(workspaceRoot);
  assert.equal(validation.status, "complete");
});

test("repairs a partially wired ESM spec by creating the missing shared setup file", () => {
  const workspaceRoot = createWorkspace({
    "package.json": JSON.stringify(
      {
        name: "client-repo",
        version: "1.0.0",
        type: "module",
        devDependencies: {
          "@playwright/test": "^1.52.0"
        }
      },
      null,
      2
    ),
    "tests/example.spec.js": [
      'import { expect } from "@playwright/test";',
      'import { test } from "./setup.selector-shot.js";',
      "",
      'test("works", async ({ page }) => {',
      '  await expect(page.locator("[data-testid=\'hero\']")).toBeVisible();',
      "});",
      ""
    ].join("\n")
  });

  const beforeValidation = validateWorkspace(workspaceRoot);
  assert.equal(beforeValidation.status, "broken");

  const result = bootstrapWorkspace(workspaceRoot, {
    ensureDependency: installHelperDependency
  });

  assert.equal(result.status, "success");
  assert.match(result.summary, /created 1 shared setup file/i);
  assert.match(result.summary, /patched 1 test entry point/i);
  assert.equal(fs.existsSync(path.join(workspaceRoot, "tests", "setup.selector-shot.js")), true);

  const specContents = readFile(workspaceRoot, "tests/example.spec.js");
  assert.equal(specContents.includes('from "@playwright/test"'), false);
  assert.equal(specContents.includes('from "./setup.selector-shot.js"'), true);

  const validation = validateWorkspace(workspaceRoot);
  assert.equal(validation.status, "complete");
});

test("repairs a spec that already imports a missing setup.selector-shot entry point", () => {
  const workspaceRoot = createWorkspace({
    "package.json": JSON.stringify(
      {
        name: "client-repo",
        version: "1.0.0",
        type: "module",
        devDependencies: {
          "@playwright/test": "^1.52.0"
        }
      },
      null,
      2
    ),
    "tests/example.spec.js": [
      'import { expect, test } from "./setup.selector-shot";',
      "",
      'test("works", async ({ page }) => {',
      '  await expect(page.locator("[data-testid=\'hero\']")).toBeVisible();',
      "});",
      ""
    ].join("\n")
  });

  const beforeValidation = validateWorkspace(workspaceRoot);
  assert.equal(beforeValidation.status, "broken");
  assert.match(beforeValidation.summary, /does not exist/i);

  const result = bootstrapWorkspace(workspaceRoot, {
    ensureDependency: installHelperDependency
  });

  assert.equal(result.status, "success");
  assert.match(result.summary, /created 1 shared setup file/i);
  assert.equal(result.summary.includes("patched 1 test entry point"), false);
  assert.equal(fs.existsSync(path.join(workspaceRoot, "tests", "setup.selector-shot.js")), true);

  const specContents = readFile(workspaceRoot, "tests/example.spec.js");
  assert.equal(specContents.includes('from "./setup.selector-shot";'), true);

  const validation = validateWorkspace(workspaceRoot);
  assert.equal(validation.status, "complete");
});

test("patches a namespace-imported CommonJS shared fixture without creating an extra setup file", () => {
  const workspaceRoot = createWorkspace({
    "package.json": JSON.stringify(
      {
        name: "client-repo",
        version: "1.0.0",
        devDependencies: {
          "@playwright/test": "^1.52.0",
          "@getulionm/selector-shot-playwright": "^0.0.6"
        }
      },
      null,
      2
    ),
    "tests/fixtures/base.fixture.js": [
      'const playwright = require("@playwright/test");',
      'const { test, expect } = playwright;',
      "",
      "module.exports = { test, expect };",
      ""
    ].join("\n"),
    "tests/playwright/custom-fixture.spec.js": [
      'const fixtures = require("../fixtures/base.fixture");',
      "",
      'fixtures.test("works", async ({ page }) => {',
      '  await fixtures.expect(page.locator("button[data-testid=\'save\']")).toBeVisible();',
      "});",
      ""
    ].join("\n")
  });

  const result = bootstrapWorkspace(workspaceRoot);

  assert.equal(result.status, "success");
  assert.match(result.summary, /patched 1 shared fixture/i);
  assert.equal(fs.existsSync(path.join(workspaceRoot, "tests", "playwright", "setup.selector-shot.js")), false);

  const fixtureContents = readFile(workspaceRoot, "tests/fixtures/base.fixture.js");
  assert.match(fixtureContents, /const \{ installSelectorShot \} = require\("@getulionm\/selector-shot-playwright"\);/);
  assert.match(fixtureContents, /installSelectorShot\(test, \{/);

  const specContents = readFile(workspaceRoot, "tests/playwright/custom-fixture.spec.js");
  assert.equal(specContents.includes("setup.selector-shot"), false);

  const validation = validateWorkspace(workspaceRoot);
  assert.equal(validation.status, "complete");
});

test("returns partial when duplicate setup files already exist in the same folder", () => {
  const workspaceRoot = createWorkspace({
    "package.json": JSON.stringify(
      {
        name: "client-repo",
        version: "1.0.0",
        devDependencies: {
          "@playwright/test": "^1.52.0",
          "@getulionm/selector-shot-playwright": "^0.0.6"
        }
      },
      null,
      2
    ),
    "tests/setup.selector-shot.ts": [
      'import * as playwright from "@playwright/test";',
      'import { installSelectorShot } from "@getulionm/selector-shot-playwright";',
      "",
      "const { test, expect } = playwright;",
      "",
      'if (process.env.SELECTOR_SHOT_CAPTURE === "1") {',
      "  installSelectorShot(test, {",
      '    outDir: ".selector-shot"',
      "  });",
      "}",
      "",
      'export * from "@playwright/test";',
      "export { test, expect };",
      ""
    ].join("\n"),
    "tests/setup.selector-shot.js": [
      'const playwright = require("@playwright/test");',
      'const { installSelectorShot } = require("@getulionm/selector-shot-playwright");',
      "",
      "const { test, expect } = playwright;",
      "",
      'if (process.env.SELECTOR_SHOT_CAPTURE === "1") {',
      "  installSelectorShot(test, {",
      '    outDir: ".selector-shot"',
      "  });",
      "}",
      "",
      "module.exports = { ...playwright, test, expect };",
      ""
    ].join("\n"),
    "tests/example.spec.ts": [
      'import { test, expect } from "@playwright/test";',
      "",
      'test("works", async ({ page }) => {',
      '  await expect(page.locator("[data-testid=\'hero\']")).toBeVisible();',
      "});",
      ""
    ].join("\n")
  });

  const result = bootstrapWorkspace(workspaceRoot);

  assert.equal(result.status, "partial");
  assert.match(result.summary, /Multiple setup\.selector-shot files exist/i);

  const specContents = readFile(workspaceRoot, "tests/example.spec.ts");
  assert.equal(specContents.includes('from "./setup.selector-shot"'), true);

  const validation = validateWorkspace(workspaceRoot);
  assert.equal(validation.status, "duplicate");
});
