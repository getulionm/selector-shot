import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import * as vscode from "vscode";
import {
  buildSelectorShotInstallCommand,
  codeLensTitleForItem,
  formatCaptureTime,
  lineContainsConcreteSelectorText
} from "./logic";

type SelectorShotMeta = {
  status?: string;
  error?: string;
  createdAt?: string;
  source?: {
    filePath?: string;
    line?: number;
    column?: number;
  };
  imagePath?: string;
};

type LensItem = {
  line: number;
  imagePath: string;
  createdAt: string;
  status: string;
  error?: string;
};

type ShotRecord = {
  selector: string;
  testTitle: string;
  sourcePath: string;
  line: number;
  imagePath: string;
  createdAt: string;
  status: string;
  error?: string;
  runKey: string;
};

class SelectorShotLensProvider implements vscode.CodeLensProvider {
  private readonly emitter = new vscode.EventEmitter<void>();
  private readonly index = new Map<string, Map<number, LensItem>>();

  get onDidChangeCodeLenses(): vscode.Event<void> {
    return this.emitter.event;
  }

  async refreshIndex() {
    this.index.clear();
    const config = vscode.workspace.getConfiguration("selectorShot");
    const enabled = config.get<boolean>("enabled", true);
    if (!enabled) {
      this.emitter.fire();
      return;
    }
    const onlyCaptured = config.get<boolean>("onlyCaptured", true);
    const files = await this.findMetaFiles();
    for (const file of files) {
      this.indexMetaFile(file, onlyCaptured);
    }
    this.emitter.fire();
  }

  getImagePath(sourcePath: string, line: number): string | undefined {
    const key = normalizePath(sourcePath);
    return this.index.get(key)?.get(line)?.imagePath;
  }

  getLensItem(sourcePath: string, line: number): LensItem | undefined {
    const key = normalizePath(sourcePath);
    return this.index.get(key)?.get(line);
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const key = normalizePath(document.uri.fsPath);
    const byLine = this.index.get(key);
    if (!byLine) {
      return [];
    }

    const output: vscode.CodeLens[] = [];
    for (const [line, item] of byLine.entries()) {
      if (!lineContainsConcreteSelector(document, line)) {
        continue;
      }

      const zeroLine = Math.max(line - 1, 0);
      const range = new vscode.Range(zeroLine, 0, zeroLine, 0);
      output.push(
        new vscode.CodeLens(range, {
          title: codeLensTitleForItem(item),
          command: "selectorShot.openImage",
          arguments: [item.imagePath, document.uri.fsPath, line]
        })
      );
    }

    return output;
  }

  private async findMetaFiles(): Promise<string[]> {
    const config = vscode.workspace.getConfiguration("selectorShot");
    const glob = config.get<string>("dataGlob", ".selector-shot/**/*.json");
    const uris = await vscode.workspace.findFiles(glob);
    return uris.map((uri) => uri.fsPath);
  }

  async readShotRecords(): Promise<ShotRecord[]> {
    const files = await this.findMetaFiles();
    const records: ShotRecord[] = [];
    for (const file of files) {
      const parsed = this.parseMetaFile(file);
      if (!parsed) {
        continue;
      }
      records.push(parsed);
    }
    return records;
  }

  private parseMetaFile(metaPath: string): ShotRecord | undefined {
    let parsed: SelectorShotMeta & { selector?: string; testTitle?: string } | null = null;
    try {
      const raw = fs.readFileSync(metaPath, "utf8");
      parsed = JSON.parse(raw) as SelectorShotMeta & { selector?: string; testTitle?: string };
    } catch {
      return undefined;
    }

    if (!parsed || !parsed.source || !parsed.source.filePath || !parsed.source.line || !parsed.imagePath) {
      return undefined;
    }

    const imagePath = path.isAbsolute(parsed.imagePath)
      ? path.normalize(parsed.imagePath)
      : path.resolve(path.dirname(metaPath), parsed.imagePath);
    const runKey = path.basename(path.dirname(path.dirname(metaPath)));

    return {
      selector: parsed.selector || "<unknown selector>",
      testTitle: parsed.testTitle || "<unknown test>",
      sourcePath: parsed.source.filePath,
      line: parsed.source.line,
      imagePath,
      createdAt: parsed.createdAt || "",
      status: parsed.status || "",
      error: parsed.error,
      runKey
    };
  }

  private indexMetaFile(metaPath: string, onlyCaptured: boolean) {
    const parsed = this.parseMetaFile(metaPath);
    if (!parsed) {
      return;
    }

    const sourcePath = normalizePath(parsed.sourcePath);
    const line = parsed.line;
    const createdAt = parsed.createdAt || "";
    const imagePath = parsed.imagePath;
    const status = parsed.status || "";
    const imageExists = fs.existsSync(imagePath);
    const isFailed = status === "failed";
    if (!imageExists && !isFailed) {
      return;
    }
    const incomingIsCaptured = status === "captured";
    const error = parsed.error;

    const byLine = this.index.get(sourcePath) || new Map<number, LensItem>();
    const existing = byLine.get(line);
    if (!existing) {
      byLine.set(line, { line, imagePath, createdAt, status, error });
      this.index.set(sourcePath, byLine);
      return;
    }

    if (!onlyCaptured) {
      if (createdAt > existing.createdAt) {
        byLine.set(line, { line, imagePath, createdAt, status, error });
      }
      this.index.set(sourcePath, byLine);
      return;
    }

    const existingIsCaptured = existing.status === "captured";
    if (existingIsCaptured && !incomingIsCaptured) {
      return;
    }

    if (!existingIsCaptured && incomingIsCaptured) {
      byLine.set(line, { line, imagePath, createdAt, status, error });
      this.index.set(sourcePath, byLine);
      return;
    }

    if (createdAt > existing.createdAt) {
      byLine.set(line, { line, imagePath, createdAt, status, error });
    }
    this.index.set(sourcePath, byLine);
  }
}

function normalizePath(filePath: string): string {
  const normalized = path.normalize(filePath);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function lineContainsConcreteSelector(document: vscode.TextDocument, oneBasedLine: number): boolean {
  const zeroBasedLine = oneBasedLine - 1;
  if (zeroBasedLine < 0 || zeroBasedLine >= document.lineCount) {
    return false;
  }

  const text = document.lineAt(zeroBasedLine).text;
  return lineContainsConcreteSelectorText(text);
}

type BootstrapResult = {
  changedFiles: string[];
  notes: string[];
  installedDependency: boolean;
  status: "success" | "partial" | "failed" | "noop";
  summary: string;
};

function fileExists(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function toImportPath(fromDir: string, targetFilePath: string): string {
  const relative = path.relative(fromDir, targetFilePath).replace(/\\/g, "/");
  const withoutExtension = relative.replace(/\.[cm]?[jt]sx?$/i, "");
  if (withoutExtension.startsWith(".")) {
    return withoutExtension;
  }
  return `./${withoutExtension}`;
}

function patchPlaywrightSpecImports(contents: string, setupImportPath: string): string {
  if (
    contents.includes(`from "${setupImportPath}"`) ||
    contents.includes(`from '${setupImportPath}'`)
  ) {
    return contents;
  }

  const importRegex = /import\s*\{([\s\S]*?)\}\s*from\s*["']@playwright\/test["'];?/m;
  const match = contents.match(importRegex);
  if (!match) {
    return contents;
  }

  const names = match[1]
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  if (!names.includes("test")) {
    return contents;
  }

  const kept = names.filter((name) => name !== "test");
  const rewrittenImport = kept.length > 0 ? `import { ${kept.join(", ")} } from "@playwright/test";` : "";
  let updated = contents.replace(importRegex, rewrittenImport);

  const setupImport = `import { test } from "${setupImportPath}";`;
  const lines = updated.split(/\r?\n/);
  let insertAt = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (line.startsWith("import ")) {
      insertAt = i + 1;
      continue;
    }
    if (line === "" && insertAt > 0) {
      insertAt = i + 1;
      continue;
    }
    break;
  }
  lines.splice(insertAt, 0, setupImport);
  updated = lines.join("\n");

  return updated.replace(/\n{3,}/g, "\n\n");
}

function patchCustomFixtureFile(contents: string): string {
  const hasInstallImport =
    contents.includes("from \"@getulionm/selector-shot-playwright\"") ||
    contents.includes("from '@getulionm/selector-shot-playwright'");
  const hasInstallCall = contents.includes("installSelectorShot(test");

  if (!contents.includes("base.extend")) {
    return contents;
  }
  if (!contents.includes("export const test")) {
    return contents;
  }

  let updated = contents;

  if (!hasInstallImport) {
    const lines = updated.split(/\r?\n/);
    let insertAt = 0;
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i].trim();
      if (line.startsWith("import ")) {
        insertAt = i + 1;
        continue;
      }
      if (line === "" && insertAt > 0) {
        insertAt = i + 1;
        continue;
      }
      break;
    }
    lines.splice(insertAt, 0, "import { installSelectorShot } from \"@getulionm/selector-shot-playwright\";");
    updated = lines.join("\n");
  }

  if (hasInstallCall) {
    const installCallRegex = /installSelectorShot\(test,\s*\{([\s\S]*?)\}\s*\);/m;
    const installMatch = updated.match(installCallRegex);
    if (!installMatch) {
      return updated;
    }

    let optionsBlock = installMatch[1];
    const ensureOption = (key, value) => {
      const keyRegex = new RegExp(`\\b${key}\\s*:`);
      if (!keyRegex.test(optionsBlock)) {
        optionsBlock = `${optionsBlock.trimEnd()}\n    ${key}: ${value},`;
      }
    };

    ensureOption("captureStrategy", "\"onUse\"");
    ensureOption("skipMissingSelectors", "true");
    ensureOption("missingSelectorTimeoutMs", "1200");
    ensureOption("captureAssertions", "true");

    const replacement = `installSelectorShot(test, {\n${optionsBlock}\n  });`;
    updated = updated.replace(installCallRegex, replacement);
    return updated.replace(/\n{3,}/g, "\n\n");
  }

  const testAssignmentRegex = /export\s+const\s+test\s*=\s*base\.extend[\s\S]*?\n\}\);/m;
  const match = updated.match(testAssignmentRegex);
  if (!match) {
    return updated;
  }

  const installBlock =
    "\n\nif (process.env.SELECTOR_SHOT_CAPTURE === \"1\") {\n" +
    "  installSelectorShot(test, {\n" +
    "    outDir: \".selector-shot\",\n" +
    "    maxPerTest: 60,\n" +
    "    captureTimeoutMs: 2500,\n" +
    "    preCaptureWaitMs: 750,\n" +
    "    captureRetries: 0,\n" +
    "    maxAfterEachMs: 8000,\n" +
    "    captureStrategy: \"onUse\",\n" +
    "    skipMissingSelectors: true,\n" +
    "    missingSelectorTimeoutMs: 1200,\n" +
    "    captureAssertions: true\n" +
    "  });\n" +
    "}";

  const start = match.index || 0;
  const end = start + match[0].length;
  updated = `${updated.slice(0, end)}${installBlock}${updated.slice(end)}`;
  return updated.replace(/\n{3,}/g, "\n\n");
}

function resolveImportToFile(specPath: string, importPath: string): string | undefined {
  const baseDir = path.dirname(specPath);
  const resolvedBase = path.resolve(baseDir, importPath);
  const candidates = [
    resolvedBase,
    `${resolvedBase}.ts`,
    `${resolvedBase}.tsx`,
    `${resolvedBase}.js`,
    `${resolvedBase}.jsx`,
    path.join(resolvedBase, "index.ts"),
    path.join(resolvedBase, "index.tsx"),
    path.join(resolvedBase, "index.js"),
    path.join(resolvedBase, "index.jsx")
  ];
  for (const candidate of candidates) {
    if (fileExists(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function findCustomFixtureImportsInSpec(specPath: string, contents: string): string[] {
  const results: string[] = [];
  const importRegex = /import\s*\{([^}]*)\}\s*from\s*["']([^"']+)["'];?/g;
  let match: RegExpExecArray | null = null;
  while ((match = importRegex.exec(contents)) !== null) {
    const names = match[1]
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean);
    const source = match[2];
    if (!names.includes("test")) {
      continue;
    }
    if (!source || !source.startsWith(".")) {
      continue;
    }
    const resolved = resolveImportToFile(specPath, source);
    if (resolved) {
      results.push(resolved);
    }
  }
  return results;
}

function specNeedsSetupImportPatch(contents: string): boolean {
  const importRegex = /import\s*\{([\s\S]*?)\}\s*from\s*["']@playwright\/test["'];?/m;
  const match = contents.match(importRegex);
  if (!match) {
    return false;
  }
  const names = match[1]
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  return names.includes("test");
}

function specImportsSelectorShotSetup(contents: string): boolean {
  return /from\s*["'][^"']*setup\.selector-shot(?:\.[cm]?[jt]sx?)?["']/.test(contents);
}

function ensureSelectorShotDependency(
  workspaceRoot: string,
  packageJson?: { packageManager?: string | undefined }
): { installed: boolean; note?: string } {
  const installCommand = buildSelectorShotInstallCommand(workspaceRoot, packageJson);
  const result = spawnSync(installCommand.command, installCommand.args, {
    cwd: workspaceRoot,
    encoding: "utf8"
  });
  if (result.status === 0) {
    return { installed: true };
  }
  const detail = [
    result.error?.message,
    result.stderr,
    result.stdout
  ]
    .map((s) => (s || "").trim())
    .filter(Boolean)[0];
  if (detail) {
    return {
      installed: false,
      note:
        `Could not auto-install @getulionm/selector-shot-playwright ` +
        `with "${installCommand.command} ${installCommand.args.join(" ")}". ${detail} ` +
        `Run ${installCommand.manualCommand}.`
    };
  }
  return {
    installed: false,
    note:
      `Could not auto-install @getulionm/selector-shot-playwright ` +
      `with "${installCommand.command} ${installCommand.args.join(" ")}". ` +
      `Run ${installCommand.manualCommand}.`
  };
}

function summarizePaths(filePaths: string[], workspaceRoot: string, max = 3): string {
  const labels = filePaths
    .slice(0, max)
    .map((filePath) => path.relative(workspaceRoot, filePath).replace(/\\/g, "/"));
  if (filePaths.length <= max) {
    return labels.join(", ");
  }
  return `${labels.join(", ")} and ${filePaths.length - max} more`;
}

async function validateBootstrapWorkspace(
  workspaceRoot: string,
  dependencyMissing: boolean
): Promise<{ errors: string[]; warnings: string[] }> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const specUris = await vscode.workspace.findFiles("**/*.spec.{ts,tsx,js,jsx}", "**/node_modules/**");
  const setupCandidates = [
    path.join(workspaceRoot, "tests", "setup.selector-shot.ts"),
    path.join(workspaceRoot, "tests", "setup.selector-shot.js")
  ];
  const hasSetupFile = setupCandidates.some((candidate) => fileExists(candidate));

  const plainPlaywrightSpecs: string[] = [];
  const customFixtureSpecs: string[] = [];
  const setupImportSpecs: string[] = [];
  for (const specUri of specUris) {
    const specPath = specUri.fsPath;
    const contents = fs.readFileSync(specPath, "utf8");
    if (specNeedsSetupImportPatch(contents)) {
      plainPlaywrightSpecs.push(specPath);
    }
    if (specImportsSelectorShotSetup(contents)) {
      setupImportSpecs.push(specPath);
    }
    const fixtureImports = findCustomFixtureImportsInSpec(specPath, contents);
    if (fixtureImports.length > 0) {
      customFixtureSpecs.push(specPath);
    }
  }

  if (dependencyMissing) {
    errors.push("The Playwright helper package is still missing.");
  }

  if (plainPlaywrightSpecs.length > 0) {
    errors.push(
      `Some specs still import test directly from @playwright/test: ${summarizePaths(plainPlaywrightSpecs, workspaceRoot)}.`
    );
  }

  if ((customFixtureSpecs.length > 0 || setupImportSpecs.length > 0) && !hasSetupFile) {
    warnings.push(
      "tests/setup.selector-shot.ts is missing."
    );
  }

  return { errors, warnings };
}

function finalizeBootstrapResult(
  workspaceRoot: string,
  changedFiles: string[],
  notes: string[],
  installedDependency: boolean,
  validation: { errors: string[]; warnings: string[] }
): BootstrapResult {
  const issues = [...notes, ...validation.errors, ...validation.warnings];
  const hasFailure = validation.errors.length > 0;
  const hasWarnings = notes.length > 0 || validation.warnings.length > 0;
  const changedSummary = changedFiles.length > 0 ? `updated ${changedFiles.length} file(s)` : "updated 0 files";

  if (hasFailure) {
    return {
      changedFiles,
      notes: issues,
      installedDependency,
      status: "failed",
      summary: `Selector Shot bootstrap failed: ${issues.join(" ")}`
    };
  }

  if (hasWarnings) {
    return {
      changedFiles,
      notes: issues,
      installedDependency,
      status: "partial",
      summary:
        `Selector Shot bootstrap is partial: ${changedSummary}. ` +
        `${issues.join(" ")}`
    };
  }

  if (changedFiles.length > 0 || installedDependency) {
    return {
      changedFiles,
      notes: [],
      installedDependency,
      status: "success",
      summary:
        `Selector Shot bootstrap succeeded: ${changedSummary}` +
        `${installedDependency ? ", installed the helper package," : ","} and wiring looks complete. ` +
        `Run: npx selector-shot-update`
    };
  }

  return {
    changedFiles,
    notes: [],
    installedDependency,
    status: "noop",
    summary: "Selector Shot wiring already looks complete. Run: npx selector-shot-update"
  };
}

async function bootstrapWorkspace(): Promise<BootstrapResult> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    return {
      changedFiles: [],
      notes: ["No workspace folder is open, so bootstrap was skipped."],
      installedDependency: false,
      status: "failed",
      summary: "Selector Shot bootstrap failed: no workspace folder is open."
    };
  }

  const workspaceRoot = folder.uri.fsPath;
  const packageJsonPath = path.join(workspaceRoot, "package.json");
  if (!fileExists(packageJsonPath)) {
    return {
      changedFiles: [],
      notes: ["No package.json found in workspace root, so auto-bootstrap was skipped."],
      installedDependency: false,
      status: "failed",
      summary: "Selector Shot bootstrap failed: no package.json was found in the workspace root."
    };
  }

  const changedFiles: string[] = [];
  const notes: string[] = [];
  let installedDependency = false;

  let packageJson: any;
  try {
    packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  } catch {
    return {
      changedFiles: [],
      notes: ["package.json could not be parsed, so auto-bootstrap was skipped."],
      installedDependency: false,
      status: "failed",
      summary: "Selector Shot bootstrap failed: package.json could not be parsed."
    };
  }

  let packageJsonChanged = false;
  packageJson.scripts = packageJson.scripts || {};
  if (!packageJson.scripts["test:selector-shot-update"]) {
    packageJson.scripts["test:selector-shot-update"] = "selector-shot-update";
    packageJsonChanged = true;
  }

  const hasSelectorShotDependency = Boolean(
    packageJson.dependencies?.["@getulionm/selector-shot-playwright"] ||
    packageJson.devDependencies?.["@getulionm/selector-shot-playwright"]
  );
  if (!hasSelectorShotDependency) {
    const installResult = ensureSelectorShotDependency(workspaceRoot, packageJson);
    installedDependency = installResult.installed;
    if (!installResult.installed && installResult.note) {
      notes.push(installResult.note);
    }
  }

  const specUris = await vscode.workspace.findFiles("**/*.spec.{ts,tsx,js,jsx}", "**/node_modules/**");
  const fixtureCandidates = new Set<string>();
  const specsNeedingSetupPatch: string[] = [];
  const specsReferencingSetupImport: string[] = [];

  for (const specUri of specUris) {
    const specPath = specUri.fsPath;
    const original = fs.readFileSync(specPath, "utf8");
    const fixtureImports = findCustomFixtureImportsInSpec(specPath, original);
    for (const fixturePath of fixtureImports) {
      fixtureCandidates.add(fixturePath);
    }
    if (specNeedsSetupImportPatch(original)) {
      specsNeedingSetupPatch.push(specPath);
    }
    if (specImportsSelectorShotSetup(original)) {
      specsReferencingSetupImport.push(specPath);
    }
  }

  for (const fixturePath of fixtureCandidates) {
    const original = fs.readFileSync(fixturePath, "utf8");
    const updated = patchCustomFixtureFile(original);
    if (updated !== original) {
      fs.writeFileSync(fixturePath, updated, "utf8");
      changedFiles.push(fixturePath);
    }
  }

  const shouldEnsureSetupFile = specUris.length > 0;
  if (shouldEnsureSetupFile) {
    const setupRelevantSpecs = [...specsNeedingSetupPatch, ...specsReferencingSetupImport];
    const hasTsSpec = setupRelevantSpecs.some((specPath) => specPath.endsWith(".ts") || specPath.endsWith(".tsx"));
    const setupExtension = hasTsSpec ? "ts" : "js";
    const setupPath = path.join(workspaceRoot, "tests", `setup.selector-shot.${setupExtension}`);
    if (!fileExists(setupPath)) {
      fs.mkdirSync(path.dirname(setupPath), { recursive: true });
      const setupContents =
        "import { test } from \"@playwright/test\";\n" +
        "import { installSelectorShot } from \"@getulionm/selector-shot-playwright\";\n\n" +
        "if (process.env.SELECTOR_SHOT_CAPTURE === \"1\") {\n" +
        "  installSelectorShot(test, {\n" +
        "    outDir: \".selector-shot\",\n" +
        "    maxPerTest: 60,\n" +
        "    captureTimeoutMs: 2500,\n" +
        "    preCaptureWaitMs: 750,\n" +
        "    captureRetries: 0,\n" +
        "    maxAfterEachMs: 8000,\n" +
        "    captureStrategy: \"onUse\",\n" +
        "    skipMissingSelectors: true,\n" +
        "    missingSelectorTimeoutMs: 1200,\n" +
        "    captureAssertions: true\n" +
        "  });\n" +
        "}\n\n" +
        "export { test };\n";
      fs.writeFileSync(setupPath, setupContents, "utf8");
      changedFiles.push(setupPath);
    }

    for (const specPath of specsNeedingSetupPatch) {
      const original = fs.readFileSync(specPath, "utf8");
      const setupImportPath = toImportPath(path.dirname(specPath), setupPath);
      const updated = patchPlaywrightSpecImports(original, setupImportPath);
      if (updated !== original) {
        fs.writeFileSync(specPath, updated, "utf8");
        changedFiles.push(specPath);
      }
    }
  }

  if (packageJsonChanged) {
    fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");
    changedFiles.push(packageJsonPath);
  }

  const dependencyMissing = !Boolean(
    packageJson.dependencies?.["@getulionm/selector-shot-playwright"] ||
    packageJson.devDependencies?.["@getulionm/selector-shot-playwright"] ||
    installedDependency
  );
  const validation = await validateBootstrapWorkspace(workspaceRoot, dependencyMissing);
  return finalizeBootstrapResult(workspaceRoot, changedFiles, notes, installedDependency, validation);
}

function showBootstrapResult(
  bootstrap: BootstrapResult,
  action: "setup" | "enable"
) {
  const prefix = action === "enable" ? "Selector Shot enable" : "Selector Shot setup";
  const message = bootstrap.summary.replace(/^Selector Shot bootstrap/, prefix);
  if (bootstrap.status === "failed") {
    void vscode.window.showErrorMessage(message);
    return;
  }
  if (bootstrap.status === "partial") {
    void vscode.window.showWarningMessage(message);
    return;
  }
  void vscode.window.showInformationMessage(message);
}

export function activate(context: vscode.ExtensionContext) {
  const provider = new SelectorShotLensProvider();
  let refreshTimer: NodeJS.Timeout | undefined;

  const scheduleRefresh = () => {
    if (refreshTimer) {
      clearTimeout(refreshTimer);
    }

    refreshTimer = setTimeout(() => {
      provider.refreshIndex().catch(() => {
        // no-op for refresh failures
      });
    }, 150);
  };

  const config = vscode.workspace.getConfiguration("selectorShot");
  const dataGlob = config.get<string>("dataGlob", ".selector-shot/**/*.json");
  const shotWatcher = vscode.workspace.createFileSystemWatcher(dataGlob);
  context.subscriptions.push(
    shotWatcher,
    shotWatcher.onDidCreate(scheduleRefresh),
    shotWatcher.onDidChange(scheduleRefresh),
    shotWatcher.onDidDelete(scheduleRefresh)
  );

  context.subscriptions.push(
    vscode.window.onDidChangeWindowState((state) => {
      if (state.focused) {
        scheduleRefresh();
      }
    }),
    vscode.window.onDidChangeActiveTextEditor(() => {
      scheduleRefresh();
    })
  );

  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      [{ language: "javascript" }, { language: "typescript" }, { language: "javascriptreact" }, { language: "typescriptreact" }],
      provider
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("selectorShot.setup", async () => {
      const bootstrap = await bootstrapWorkspace();
      showBootstrapResult(bootstrap, "setup");
    }),
    vscode.commands.registerCommand("selectorShot.enable", async () => {
      const bootstrap = await bootstrapWorkspace();
      await vscode.workspace.getConfiguration("selectorShot").update("enabled", true, vscode.ConfigurationTarget.Workspace);
      await provider.refreshIndex();
      showBootstrapResult(bootstrap, "enable");
    }),
    vscode.commands.registerCommand("selectorShot.disable", async () => {
      await vscode.workspace
        .getConfiguration("selectorShot")
        .update("enabled", false, vscode.ConfigurationTarget.Workspace);
      await provider.refreshIndex();
      vscode.window.showInformationMessage("Selector Shot disabled for this workspace.");
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("selectorShot.enabled")) {
        scheduleRefresh();
      }
    }),
    vscode.commands.registerCommand("selectorShot.refresh", async () => {
      await provider.refreshIndex();
      vscode.window.showInformationMessage("Selector Shot index refreshed.");
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("selectorShot.openImage", async (imagePath: string, sourcePath?: string, line?: number) => {
      if (!imagePath) {
        const records = await provider.readShotRecords();
        if (records.length === 0) {
          vscode.window.showInformationMessage("No selector-shot captures found. Run: npx selector-shot-update");
          return;
        }

        let latestRunKey = "";
        let latestCreatedAt = "";
        for (const record of records) {
          if (record.createdAt > latestCreatedAt) {
            latestCreatedAt = record.createdAt;
            latestRunKey = record.runKey;
          }
        }
        const fromLatestRun = latestRunKey
          ? records.filter((record) => record.runKey === latestRunKey)
          : records.slice();
        const sorted = fromLatestRun.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

        const picks = sorted.map((record) => ({
          label: record.selector,
          description: `${path.basename(record.sourcePath)}:${record.line}`,
          detail: `${record.testTitle} (${record.status || "unknown"})`,
          record
        }));

        const selected = await vscode.window.showQuickPick(picks, {
          title: "Selector Shot: Open Screenshot (Latest Run)",
          placeHolder: "Choose a selector capture"
        });
        if (!selected) {
          return;
        }

        imagePath = selected.record.imagePath;
        sourcePath = selected.record.sourcePath;
        line = selected.record.line;
      }

      if (imagePath && fs.existsSync(imagePath)) {
        const uri = vscode.Uri.file(imagePath);
        await vscode.commands.executeCommand("vscode.open", uri);
        return;
      }

      if (sourcePath && typeof line === "number") {
        await provider.refreshIndex();
        const latest = provider.getLensItem(sourcePath, line);
        if (latest?.imagePath && fs.existsSync(latest.imagePath)) {
          const uri = vscode.Uri.file(latest.imagePath);
          await vscode.commands.executeCommand("vscode.open", uri);
          return;
        }
        if (latest?.status === "failed") {
          const when = formatCaptureTime(latest.createdAt);
          const detail = latest.error ? `: ${latest.error}` : "";
          vscode.window.showWarningMessage(`Selector screenshot capture failed (${when})${detail}`);
          return;
        }
      }

      vscode.window.showWarningMessage("Selector screenshot not found on disk.");
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(async () => {
      await provider.refreshIndex();
    }),
    new vscode.Disposable(() => {
      if (refreshTimer) {
        clearTimeout(refreshTimer);
      }
    })
  );

  provider.refreshIndex().catch(() => {
    // no-op for initial startup failures
  });
}

export function deactivate() { }
