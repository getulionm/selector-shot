const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const vscode = require("vscode");

const SOURCE_RELATIVE_PATH = path.join("tests", "playwright", "example.spec.ts");
const SOURCE_LINE = 7;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeoutMs = 10000, intervalMs = 200) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = await predicate();
    if (value) {
      return value;
    }
    await sleep(intervalMs);
  }

  throw new Error("Timed out waiting for condition.");
}

async function readCodeLens(uri) {
  const lenses = await vscode.commands.executeCommand("vscode.executeCodeLensProvider", uri);
  return Array.isArray(lenses) ? lenses : [];
}

function hasLensForImage(lenses, imagePath) {
  return lenses.some((lens) => lens.command?.command === "selectorShot.openImage" && lens.command.arguments?.[0] === imagePath);
}

function findLensForImage(lenses, imagePath) {
  return lenses.find((lens) => lens.command?.command === "selectorShot.openImage" && lens.command.arguments?.[0] === imagePath);
}

async function findLineNumber(sourcePath, snippet) {
  const contents = await fs.readFile(sourcePath, "utf8");
  const lines = contents.split(/\r?\n/);
  const index = lines.findIndex((line) => line.includes(snippet));
  if (index < 0) {
    throw new Error(`Could not find snippet in fixture source: ${snippet}`);
  }
  return index + 1;
}

async function writeShot(
  root,
  runName,
  sourcePath,
  selector,
  createdAtIso,
  status = "captured",
  sourceLine = SOURCE_LINE,
  writeImage = true
) {
  const runDir = path.join(root, ".selector-shot", runName);
  await fs.mkdir(runDir, { recursive: true });

  const imagePath = path.join(runDir, `001-${selector.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}.png`);
  const metaPath = path.join(runDir, "001-meta.json");

  if (writeImage) {
    await fs.writeFile(imagePath, "");
  }
  await fs.writeFile(
    metaPath,
    JSON.stringify(
      {
        selector,
        testTitle: "integration",
        source: {
          filePath: sourcePath,
          line: sourceLine,
          column: 29
        },
        imagePath,
        createdAt: createdAtIso,
        status
      },
      null,
      2
    )
  );

  return imagePath;
}

async function testManualRefreshLoadsLens(workspaceRoot, sourcePath, sourceUri) {
  const firstImage = await writeShot(workspaceRoot, "integration-run-1", sourcePath, "a[href*=iana]", "2026-02-26T00:00:00.000Z");

  await vscode.commands.executeCommand("selectorShot.refresh");

  const lenses = await waitFor(async () => {
    const current = await readCodeLens(sourceUri);
    return hasLensForImage(current, firstImage) ? current : null;
  });

  assert.ok(hasLensForImage(lenses, firstImage), "Expected a CodeLens pointing to the first generated image.");
}

async function testWatcherRefreshesLens(workspaceRoot, sourcePath, sourceUri) {
  const secondImage = await writeShot(workspaceRoot, "integration-run-2", sourcePath, "h1", "2026-02-26T00:00:01.000Z");

  const lenses = await waitFor(async () => {
    const current = await readCodeLens(sourceUri);
    return hasLensForImage(current, secondImage) ? current : null;
  });

  assert.ok(hasLensForImage(lenses, secondImage), "Expected watcher-driven refresh to surface the newest image without manual refresh.");
}

async function testOnlyCapturedFallsBackWhenNoCaptured(workspaceRoot, sourcePath, sourceUri) {
  const fallbackImage = await writeShot(
    workspaceRoot,
    "integration-run-failed-only",
    sourcePath,
    "button[data-testid=save]",
    "2026-02-26T00:00:02.000Z",
    "failed",
    SOURCE_LINE + 1
  );

  await vscode.commands.executeCommand("selectorShot.refresh");

  const lenses = await waitFor(async () => {
    const current = await readCodeLens(sourceUri);
    return hasLensForImage(current, fallbackImage) ? current : null;
  });

  assert.ok(
    hasLensForImage(lenses, fallbackImage),
    "Expected onlyCaptured mode to fall back to the latest failed record when no captured record exists for the line."
  );
}

async function testFailedWithoutImageStillShowsLens(workspaceRoot, sourcePath, sourceUri) {
  const failedLine = await findLineNumber(sourcePath, "page.locator(selectors.birthdate)");
  const failedImagePath = await writeShot(
    workspaceRoot,
    "integration-run-failed-no-image",
    sourcePath,
    "#missing-image",
    "2026-02-26T00:00:04.000Z",
    "failed",
    failedLine,
    false
  );

  await vscode.commands.executeCommand("selectorShot.refresh");

  const lenses = await waitFor(async () => {
    const current = await readCodeLens(sourceUri);
    return hasLensForImage(current, failedImagePath) ? current : null;
  });

  assert.ok(
    hasLensForImage(lenses, failedImagePath),
    "Expected failed selector-shot records without PNG to still show CodeLens."
  );

  const failedLens = findLensForImage(lenses, failedImagePath);
  assert.ok(failedLens, "Expected to find failed selector-shot CodeLens.");
  assert.match(
    failedLens.command?.title || "",
    /^Failed selector screenshot capture \(.+\)$/,
    "Expected failed CodeLens title with capture time."
  );
}

async function testSelectorMemberReferenceShowsLens(workspaceRoot, sourcePath, sourceUri) {
  const memberSelectorLine = await findLineNumber(sourcePath, "page.locator(selectors.firstName)");
  const memberRefImage = await writeShot(
    workspaceRoot,
    "integration-run-member-selector",
    sourcePath,
    "#firstName",
    "2026-02-26T00:00:03.000Z",
    "captured",
    memberSelectorLine
  );

  await vscode.commands.executeCommand("selectorShot.refresh");

  const lenses = await waitFor(async () => {
    const current = await readCodeLens(sourceUri);
    return hasLensForImage(current, memberRefImage) ? current : null;
  });

  assert.ok(
    hasLensForImage(lenses, memberRefImage),
    "Expected CodeLens for selector member references like page.locator(selectors.firstName)."
  );
}

async function testStringLiteralSelectorShowsLens(workspaceRoot, sourcePath, sourceUri) {
  const literalLine = await findLineNumber(sourcePath, "page.locator(\"#id\")");
  const literalImage = await writeShot(
    workspaceRoot,
    "integration-run-literal-selector",
    sourcePath,
    "#id",
    "2026-02-26T00:00:05.000Z",
    "captured",
    literalLine
  );

  await vscode.commands.executeCommand("selectorShot.refresh");

  const lenses = await waitFor(async () => {
    const current = await readCodeLens(sourceUri);
    return hasLensForImage(current, literalImage) ? current : null;
  });

  assert.ok(
    hasLensForImage(lenses, literalImage),
    "Expected CodeLens for string-literal selector usage like page.locator(\"#id\")."
  );
}

async function testSelectorVariableShowsLens(workspaceRoot, sourcePath, sourceUri) {
  const variableLine = await findLineNumber(sourcePath, "page.locator(selector1)");
  const variableImage = await writeShot(
    workspaceRoot,
    "integration-run-variable-selector",
    sourcePath,
    "#dynamic",
    "2026-02-26T00:00:06.000Z",
    "captured",
    variableLine
  );

  await vscode.commands.executeCommand("selectorShot.refresh");

  const lenses = await waitFor(async () => {
    const current = await readCodeLens(sourceUri);
    return hasLensForImage(current, variableImage) ? current : null;
  });

  assert.ok(
    hasLensForImage(lenses, variableImage),
    "Expected CodeLens for selector variable usage like page.locator(selector1)."
  );
}

async function run() {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, "Expected test workspace to be open.");

  const workspaceRoot = folder.uri.fsPath;
  const sourcePath = path.join(workspaceRoot, SOURCE_RELATIVE_PATH);
  const sourceUri = vscode.Uri.file(sourcePath);

  await fs.rm(path.join(workspaceRoot, ".selector-shot"), { recursive: true, force: true });
  await fs.mkdir(path.dirname(sourcePath), { recursive: true });

  const doc = await vscode.workspace.openTextDocument(sourceUri);
  await vscode.window.showTextDocument(doc);

  await testManualRefreshLoadsLens(workspaceRoot, sourcePath, sourceUri);
  await testWatcherRefreshesLens(workspaceRoot, sourcePath, sourceUri);
  await testOnlyCapturedFallsBackWhenNoCaptured(workspaceRoot, sourcePath, sourceUri);
  await testFailedWithoutImageStillShowsLens(workspaceRoot, sourcePath, sourceUri);
  await testSelectorMemberReferenceShowsLens(workspaceRoot, sourcePath, sourceUri);
  await testStringLiteralSelectorShowsLens(workspaceRoot, sourcePath, sourceUri);
  await testSelectorVariableShowsLens(workspaceRoot, sourcePath, sourceUri);
}

module.exports = { run };
