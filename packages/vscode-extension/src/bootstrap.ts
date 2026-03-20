import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { buildSelectorShotInstallCommand } from "./logic";

type PackageJson = {
  packageManager?: string;
  type?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

type ModuleStyle = "esm" | "cjs";
type SourceLanguage = "ts" | "js";

type LocalEntryImport = {
  source: string;
  moduleStyle: ModuleStyle;
  resolvedPath?: string;
  intendedSetupPath?: string;
};

type DirectImportInfo = {
  moduleStyle: ModuleStyle;
  testAccessor: string;
};

type EntryFileInfo = {
  filePath: string;
  moduleStyle: ModuleStyle;
  usesPlaywright: boolean;
  wired: boolean;
  patchable: boolean;
};

type SpecInfo = {
  specPath: string;
  directImport?: DirectImportInfo;
  localEntryImports: LocalEntryImport[];
};

type SetupGroup = {
  language: SourceLanguage;
  moduleStyle: ModuleStyle;
  specPaths: string[];
  setupPath: string;
};

type WorkspaceAnalysis = {
  workspaceRoot: string;
  packageJsonPath: string;
  packageJson: PackageJson;
  hasPlaywrightDependency: boolean;
  hasSelectorShotDependency: boolean;
  playwrightConfigPaths: string[];
  setupFileConflicts: string[][];
  specs: SpecInfo[];
  entryFiles: Map<string, EntryFileInfo>;
  setupGroups: SetupGroup[];
  errors: string[];
  warnings: string[];
};

type BootstrapActionSummary = {
  installedDependency: boolean;
  createdSetupFiles: number;
  patchedSpecs: number;
  patchedFixtures: number;
};

export type BootstrapResult = {
  changedFiles: string[];
  notes: string[];
  installedDependency: boolean;
  status: "success" | "partial" | "failed" | "noop";
  summary: string;
};

export type ValidationResult = {
  status: "complete" | "duplicate" | "broken";
  errors: string[];
  warnings: string[];
  summary: string;
};

export type BootstrapOptions = {
  ensureDependency?: (workspaceRoot: string, packageJson?: PackageJson) => { installed: boolean; note?: string };
};

const HELPER_PACKAGE_NAME = "@getulionm/selector-shot-playwright";
const PLAYWRIGHT_PACKAGE_NAME = "@playwright/test";
const SPEC_FILE_RE = /\.(spec|test)\.[cm]?[jt]sx?$/i;
const PLAYWRIGHT_CONFIG_RE = /(^|[\\/])playwright\.config\.[cm]?[jt]s$/i;
const SETUP_FILE_RE = /(^|[\\/])setup\.selector-shot\.(ts|js)$/i;
const SKIPPED_DIRECTORIES = new Set([".git", ".selector-shot", "node_modules", "test-results"]);
const INSTALL_OPTION_LINES = [
  "    outDir: \".selector-shot\",",
  "    maxPerTest: 60,",
  "    captureTimeoutMs: 2500,",
  "    preCaptureWaitMs: 750,",
  "    captureRetries: 0,",
  "    maxAfterEachMs: 8000,",
  "    captureStrategy: \"onUse\",",
  "    skipMissingSelectors: true,",
  "    missingSelectorTimeoutMs: 1200,",
  "    captureAssertions: true",
  "  });",
  "}"
];

function buildInstallBlock(testAccessor: string, eol = "\n"): string {
  return [
    "if (process.env.SELECTOR_SHOT_CAPTURE === \"1\") {",
    `  installSelectorShot(${testAccessor}, {`,
    ...INSTALL_OPTION_LINES
  ].join(eol);
}

const DEFAULT_INSTALL_OPTIONS_BLOCK = buildInstallBlock("test");

function fileExists(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function readText(filePath: string): string {
  return fs.readFileSync(filePath, "utf8");
}

function detectEol(contents: string): string {
  return contents.includes("\r\n") ? "\r\n" : "\n";
}

function usesPackage(packageJson: PackageJson | undefined, packageName: string): boolean {
  return Boolean(packageJson?.dependencies?.[packageName] || packageJson?.devDependencies?.[packageName]);
}

function walkWorkspaceFiles(rootDir: string): string[] {
  const output: string[] = [];

  function visit(currentDir: string) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIPPED_DIRECTORIES.has(entry.name)) {
          continue;
        }
        visit(path.join(currentDir, entry.name));
        continue;
      }
      output.push(path.join(currentDir, entry.name));
    }
  }

  visit(rootDir);
  return output;
}

function summarizePath(filePath: string, workspaceRoot: string): string {
  return path.relative(workspaceRoot, filePath).replace(/\\/g, "/");
}

function summarizePaths(filePaths: string[], workspaceRoot: string, max = 3): string {
  const labels = filePaths.slice(0, max).map((filePath) => summarizePath(filePath, workspaceRoot));
  if (filePaths.length <= max) {
    return labels.join(", ");
  }
  return `${labels.join(", ")} and ${filePaths.length - max} more`;
}

function parseNamedBindings(bindingText: string, style: ModuleStyle): string[] {
  return bindingText
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      if (style === "esm") {
        return part.split(/\s+as\s+/i)[0].trim();
      }
      return part.split(":")[0].trim().replace(/\s*=.*$/, "").trim();
    })
    .filter(Boolean);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function bindingIncludesTest(bindingText: string, style: ModuleStyle): boolean {
  return parseNamedBindings(bindingText, style).includes("test");
}

function namespaceBindingTestAccessor(contents: string, bindingName: string): string | undefined {
  const escapedBindingName = escapeRegExp(bindingName);
  const destructureRegex = new RegExp(
    String.raw`\b(?:const|let|var)\s*\{([\s\S]*?)\}\s*=\s*${escapedBindingName}\b`,
    "m"
  );
  const destructureMatch = contents.match(destructureRegex);
  if (destructureMatch && bindingIncludesTest(destructureMatch[1], "cjs")) {
    return "test";
  }

  const memberAccessRegex = new RegExp(String.raw`\b${escapedBindingName}\s*\.\s*test\s*\(`);
  if (memberAccessRegex.test(contents)) {
    return `${bindingName}.test`;
  }

  return undefined;
}

function findDirectPlaywrightImport(contents: string): DirectImportInfo | undefined {
  const esmRegex = /import\s+(?:type\s+)?\{([\s\S]*?)\}\s+from\s+["']@playwright\/test["'];?/gm;
  let match: RegExpExecArray | null = null;
  while ((match = esmRegex.exec(contents)) !== null) {
    return {
      moduleStyle: "esm",
      testAccessor: "test"
    };
  }

  const cjsRegex = /\b(?:const|let|var)\s*\{([\s\S]*?)\}\s*=\s*require\(\s*["']@playwright\/test["']\s*\);?/gm;
  while ((match = cjsRegex.exec(contents)) !== null) {
    return {
      moduleStyle: "cjs",
      testAccessor: "test"
    };
  }

  const esmNamespaceRegex = /import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+["']@playwright\/test["'];?/gm;
  while ((match = esmNamespaceRegex.exec(contents)) !== null) {
    return {
      moduleStyle: "esm",
      testAccessor: namespaceBindingTestAccessor(contents, match[1]) || "test"
    };
  }

  const cjsNamespaceRegex = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\(\s*["']@playwright\/test["']\s*\);?/gm;
  while ((match = cjsNamespaceRegex.exec(contents)) !== null) {
    return {
      moduleStyle: "cjs",
      testAccessor: namespaceBindingTestAccessor(contents, match[1]) || "test"
    };
  }

  return undefined;
}

function resolveImportToFile(fromFilePath: string, source: string): string | undefined {
  const basePath = path.resolve(path.dirname(fromFilePath), source);
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.js`,
    `${basePath}.jsx`,
    `${basePath}.mts`,
    `${basePath}.cts`,
    `${basePath}.mjs`,
    `${basePath}.cjs`,
    path.join(basePath, "index.ts"),
    path.join(basePath, "index.tsx"),
    path.join(basePath, "index.js"),
    path.join(basePath, "index.jsx"),
    path.join(basePath, "index.mts"),
    path.join(basePath, "index.cts"),
    path.join(basePath, "index.mjs"),
    path.join(basePath, "index.cjs")
  ];

  for (const candidate of candidates) {
    if (fileExists(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

function inferMissingSetupPath(specPath: string, source: string): string | undefined {
  const absoluteSourcePath = path.resolve(path.dirname(specPath), source);
  const extension = path.extname(absoluteSourcePath).toLowerCase();
  if (extension === ".ts" || extension === ".js") {
    return SETUP_FILE_RE.test(absoluteSourcePath) ? absoluteSourcePath : undefined;
  }

  if (path.basename(absoluteSourcePath) !== "setup.selector-shot") {
    return undefined;
  }

  const language: SourceLanguage = isTypeScriptFile(specPath) ? "ts" : "js";
  return `${absoluteSourcePath}.${language}`;
}

function findLocalTestImports(specPath: string, contents: string): LocalEntryImport[] {
  const results = new Map<string, LocalEntryImport>();
  const esmRegex = /import\s+(?:type\s+)?\{([\s\S]*?)\}\s+from\s+["']([^"']+)["'];?/gm;
  const cjsRegex = /\b(?:const|let|var)\s*\{([\s\S]*?)\}\s*=\s*require\(\s*["']([^"']+)["']\s*\);?/gm;
  const esmNamespaceRegex = /import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+["']([^"']+)["'];?/gm;
  const cjsNamespaceRegex = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\(\s*["']([^"']+)["']\s*\);?/gm;

  let match: RegExpExecArray | null = null;
  while ((match = esmRegex.exec(contents)) !== null) {
    if (!bindingIncludesTest(match[1], "esm")) {
      continue;
    }
    const source = match[2];
    if (!source.startsWith(".")) {
      continue;
    }
    const resolvedPath = resolveImportToFile(specPath, source);
    if (resolvedPath) {
      results.set(resolvedPath, { source, moduleStyle: "esm", resolvedPath });
      continue;
    }
    const intendedSetupPath = inferMissingSetupPath(specPath, source);
    if (intendedSetupPath) {
      results.set(`missing:${intendedSetupPath}`, { source, moduleStyle: "esm", intendedSetupPath });
    }
  }

  while ((match = esmNamespaceRegex.exec(contents)) !== null) {
    if (!namespaceBindingTestAccessor(contents, match[1])) {
      continue;
    }
    const source = match[2];
    if (!source.startsWith(".")) {
      continue;
    }
    const resolvedPath = resolveImportToFile(specPath, source);
    if (resolvedPath) {
      results.set(resolvedPath, { source, moduleStyle: "esm", resolvedPath });
      continue;
    }
    const intendedSetupPath = inferMissingSetupPath(specPath, source);
    if (intendedSetupPath) {
      results.set(`missing:${intendedSetupPath}`, { source, moduleStyle: "esm", intendedSetupPath });
    }
  }

  while ((match = cjsRegex.exec(contents)) !== null) {
    if (!bindingIncludesTest(match[1], "cjs")) {
      continue;
    }
    const source = match[2];
    if (!source.startsWith(".")) {
      continue;
    }
    const resolvedPath = resolveImportToFile(specPath, source);
    if (resolvedPath) {
      results.set(resolvedPath, { source, moduleStyle: "cjs", resolvedPath });
      continue;
    }
    const intendedSetupPath = inferMissingSetupPath(specPath, source);
    if (intendedSetupPath) {
      results.set(`missing:${intendedSetupPath}`, { source, moduleStyle: "cjs", intendedSetupPath });
    }
  }

  while ((match = cjsNamespaceRegex.exec(contents)) !== null) {
    if (!namespaceBindingTestAccessor(contents, match[1])) {
      continue;
    }
    const source = match[2];
    if (!source.startsWith(".")) {
      continue;
    }
    const resolvedPath = resolveImportToFile(specPath, source);
    if (resolvedPath) {
      results.set(resolvedPath, { source, moduleStyle: "cjs", resolvedPath });
      continue;
    }
    const intendedSetupPath = inferMissingSetupPath(specPath, source);
    if (intendedSetupPath) {
      results.set(`missing:${intendedSetupPath}`, { source, moduleStyle: "cjs", intendedSetupPath });
    }
  }

  return [...results.values()];
}

function detectModuleStyle(filePath: string, contents: string, packageJsonType?: string): ModuleStyle {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".cjs" || extension === ".cts") {
    return "cjs";
  }
  if (extension === ".mjs" || extension === ".mts") {
    return "esm";
  }
  if (/^\s*import\s/m.test(contents) || /^\s*export\s/m.test(contents)) {
    return "esm";
  }
  if (/\brequire\(/.test(contents) || /\bmodule\.exports\b/.test(contents) || /\bexports\./.test(contents)) {
    return "cjs";
  }
  if (extension === ".js" || extension === ".jsx") {
    return packageJsonType === "module" ? "esm" : "cjs";
  }
  return "esm";
}

function hasSelectorShotWiring(contents: string): boolean {
  return contents.includes(HELPER_PACKAGE_NAME) && contents.includes("installSelectorShot(");
}

function looksLikePatchableEntryFile(contents: string): boolean {
  if (!contents.includes(PLAYWRIGHT_PACKAGE_NAME)) {
    return false;
  }

  const exportsTest =
    /\bexport\s+(const|let|var)\s+test\b/.test(contents) ||
    /\bexport\s*\{[^}]*\btest\b[^}]*\}/.test(contents) ||
    /\bmodule\.exports\s*=/.test(contents) && /\btest\b/.test(contents) ||
    /\bexports\.test\b/.test(contents);

  return exportsTest;
}

function analyzeEntryFile(filePath: string, packageJsonType?: string): EntryFileInfo {
  const contents = readText(filePath);
  const moduleStyle = detectModuleStyle(filePath, contents, packageJsonType);
  const usesPlaywright = contents.includes(PLAYWRIGHT_PACKAGE_NAME) || hasSelectorShotWiring(contents) || SETUP_FILE_RE.test(filePath);
  const wired = hasSelectorShotWiring(contents);
  const patchable = wired || looksLikePatchableEntryFile(contents);

  return {
    filePath,
    moduleStyle,
    usesPlaywright,
    wired,
    patchable
  };
}

function isTypeScriptFile(filePath: string): boolean {
  return /\.(ts|tsx|mts|cts)$/i.test(filePath);
}

function commonDirectory(filePaths: string[]): string {
  if (filePaths.length === 0) {
    return "";
  }

  let current = path.dirname(path.resolve(filePaths[0]));
  for (const filePath of filePaths.slice(1)) {
    const targetDir = path.dirname(path.resolve(filePath));
    while (path.relative(current, targetDir).startsWith("..")) {
      const parentDir = path.dirname(current);
      if (parentDir === current) {
        return current;
      }
      current = parentDir;
    }
  }

  return current;
}

function findSetupFileConflicts(workspaceFiles: string[]): string[][] {
  const setupFilesByDirectory = new Map<string, string[]>();

  for (const filePath of workspaceFiles) {
    if (!SETUP_FILE_RE.test(filePath)) {
      continue;
    }
    const dirPath = path.dirname(filePath);
    const current = setupFilesByDirectory.get(dirPath) || [];
    current.push(filePath);
    setupFilesByDirectory.set(dirPath, current);
  }

  const conflicts: string[][] = [];
  for (const setupFiles of setupFilesByDirectory.values()) {
    if (setupFiles.length > 1) {
      conflicts.push(setupFiles.sort((left, right) => left.localeCompare(right)));
    }
  }

  return conflicts;
}

function groupSpecsBySetupTarget(workspaceRoot: string, specs: SpecInfo[]): SetupGroup[] {
  const grouped = new Map<string, SpecInfo[]>();

  for (const spec of specs) {
    const recoverableSetupImport = spec.localEntryImports.find((entryImport) => entryImport.intendedSetupPath && !entryImport.resolvedPath);
    if (!spec.directImport && !recoverableSetupImport) {
      continue;
    }
    const language: SourceLanguage = isTypeScriptFile(spec.specPath) ? "ts" : "js";
    const moduleStyle = spec.directImport?.moduleStyle || recoverableSetupImport?.moduleStyle;
    if (!moduleStyle) {
      continue;
    }
    const key = `${language}:${moduleStyle}`;
    const current = grouped.get(key) || [];
    current.push(spec);
    grouped.set(key, current);
  }

  const setupGroups: SetupGroup[] = [];

  for (const [key, groupSpecs] of grouped.entries()) {
    const [language, moduleStyle] = key.split(":") as [SourceLanguage, ModuleStyle];
    const missingSetupImport = groupSpecs
      .flatMap((spec) => spec.localEntryImports)
      .find((entryImport) => entryImport.intendedSetupPath && !entryImport.resolvedPath);
    if (missingSetupImport?.intendedSetupPath) {
      setupGroups.push({
        language,
        moduleStyle,
        specPaths: groupSpecs.map((spec) => spec.specPath),
        setupPath: missingSetupImport.intendedSetupPath
      });
      continue;
    }

    const baseDir = commonDirectory(groupSpecs.map((spec) => spec.specPath)) || workspaceRoot;
    const tsSetupPath = path.join(baseDir, "setup.selector-shot.ts");
    const jsSetupPath = path.join(baseDir, "setup.selector-shot.js");
    const preferredPath = language === "ts" ? tsSetupPath : jsSetupPath;
    const fallbackPath = language === "ts" ? jsSetupPath : tsSetupPath;
    const setupPath = fileExists(preferredPath)
      ? preferredPath
      : fileExists(fallbackPath)
        ? fallbackPath
        : preferredPath;

    setupGroups.push({
      language,
      moduleStyle,
      specPaths: groupSpecs.map((spec) => spec.specPath),
      setupPath
    });
  }

  return setupGroups;
}

function analyzeWorkspace(workspaceRoot: string): WorkspaceAnalysis {
  const packageJsonPath = path.join(workspaceRoot, "package.json");
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!fileExists(packageJsonPath)) {
    return {
      workspaceRoot,
      packageJsonPath,
      packageJson: {},
      hasPlaywrightDependency: false,
      hasSelectorShotDependency: false,
      playwrightConfigPaths: [],
      setupFileConflicts: [],
      specs: [],
      entryFiles: new Map<string, EntryFileInfo>(),
      setupGroups: [],
      errors: ["No package.json was found in the workspace root."],
      warnings
    };
  }

  let packageJson: PackageJson;
  try {
    packageJson = JSON.parse(readText(packageJsonPath)) as PackageJson;
  } catch {
    return {
      workspaceRoot,
      packageJsonPath,
      packageJson: {},
      hasPlaywrightDependency: false,
      hasSelectorShotDependency: false,
      playwrightConfigPaths: [],
      setupFileConflicts: [],
      specs: [],
      entryFiles: new Map<string, EntryFileInfo>(),
      setupGroups: [],
      errors: ["package.json could not be parsed."],
      warnings
    };
  }

  const workspaceFiles = walkWorkspaceFiles(workspaceRoot);
  const playwrightConfigPaths = workspaceFiles.filter((filePath) => PLAYWRIGHT_CONFIG_RE.test(filePath));
  const specFilePaths = workspaceFiles.filter((filePath) => SPEC_FILE_RE.test(filePath));
  const setupFileConflicts = findSetupFileConflicts(workspaceFiles);
  const hasPlaywrightDependency = usesPackage(packageJson, PLAYWRIGHT_PACKAGE_NAME);
  const hasSelectorShotDependency = usesPackage(packageJson, HELPER_PACKAGE_NAME);

  if (!hasPlaywrightDependency) {
    errors.push(`${PLAYWRIGHT_PACKAGE_NAME} is not installed in package.json.`);
  }

  if (playwrightConfigPaths.length === 0 && specFilePaths.length === 0) {
    errors.push("No Playwright test files or playwright.config.* files were found.");
  }

  const entryFiles = new Map<string, EntryFileInfo>();
  const specs: SpecInfo[] = [];

  for (const specPath of specFilePaths) {
    const contents = readText(specPath);
    const directImport = findDirectPlaywrightImport(contents);
    const localEntryImports = findLocalTestImports(specPath, contents);

    if (!directImport && localEntryImports.length === 0) {
      continue;
    }

    specs.push({
      specPath,
      directImport,
      localEntryImports
    });

    for (const entryImport of localEntryImports) {
      if (!entryImport.resolvedPath) {
        continue;
      }
      if (!entryFiles.has(entryImport.resolvedPath)) {
        entryFiles.set(entryImport.resolvedPath, analyzeEntryFile(entryImport.resolvedPath, packageJson.type));
      }
    }

    const nonRecoverableLocalImports = localEntryImports.filter((entryImport) => !entryImport.intendedSetupPath);
    if (directImport && nonRecoverableLocalImports.length > 0) {
      errors.push(
        `${summarizePath(specPath, workspaceRoot)} mixes direct ${PLAYWRIGHT_PACKAGE_NAME} imports with a local test entry point.`
      );
    }
  }

  if (errors.length === 0 && specs.length === 0) {
    errors.push("No Playwright test entry points were found to patch.");
  }

  for (const spec of specs) {
    for (const entryImport of spec.localEntryImports) {
      if (!entryImport.resolvedPath) {
        if (!entryImport.intendedSetupPath) {
          errors.push(
            `${summarizePath(spec.specPath, workspaceRoot)} imports ${entryImport.source} as a test entry point, but it could not be resolved.`
          );
        }
        continue;
      }
      const entryInfo = entryFiles.get(entryImport.resolvedPath);
      if (!entryInfo || !entryInfo.usesPlaywright) {
        errors.push(
          `${summarizePath(spec.specPath, workspaceRoot)} imports ${entryImport.source} as a test entry point, but it does not look like a Playwright fixture/setup file.`
        );
        continue;
      }
      if (!entryInfo.patchable) {
        errors.push(
          `${summarizePath(entryImport.resolvedPath, workspaceRoot)} could not be patched automatically as a shared Playwright entry point.`
        );
      }
    }
  }

  const setupGroups = groupSpecsBySetupTarget(workspaceRoot, specs);
  for (const conflict of setupFileConflicts) {
    warnings.push(`Multiple setup.selector-shot files exist in the same directory: ${summarizePaths(conflict, workspaceRoot)}.`);
  }

  return {
    workspaceRoot,
    packageJsonPath,
    packageJson,
    hasPlaywrightDependency,
    hasSelectorShotDependency,
    playwrightConfigPaths,
    setupFileConflicts,
    specs,
    entryFiles,
    setupGroups,
    errors,
    warnings
  };
}

function toImportPath(fromDir: string, targetFilePath: string): string {
  const relative = path.relative(fromDir, targetFilePath).replace(/\\/g, "/");
  const withoutExtension = relative.replace(/\.[cm]?[jt]sx?$/i, "");
  return withoutExtension.startsWith(".") ? withoutExtension : `./${withoutExtension}`;
}

function findTopLevelInsertionIndex(lines: string[], moduleStyle: ModuleStyle): number {
  let insertAt = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (moduleStyle === "esm") {
      if (line.startsWith("import ")) {
        insertAt = index + 1;
        continue;
      }
      if (line === "" && insertAt > 0) {
        insertAt = index + 1;
        continue;
      }
      break;
    }

    if (line === "\"use strict\";" || line === "'use strict';" || /\brequire\(/.test(line)) {
      insertAt = index + 1;
      continue;
    }
    if (line === "" && insertAt > 0) {
      insertAt = index + 1;
      continue;
    }
    break;
  }

  return insertAt;
}

function replacePlaywrightImportSource(contents: string, replacementSource: string): string {
  return contents.replace(/from\s*(["'])@playwright\/test\1/g, (_match, quote: string) => {
    return `from ${quote}${replacementSource}${quote}`;
  });
}

function replacePlaywrightRequireSource(contents: string, replacementSource: string): string {
  return contents.replace(/require\(\s*(["'])@playwright\/test\1\s*\)/g, (_match, quote: string) => {
    return `require(${quote}${replacementSource}${quote})`;
  });
}

function patchSpecToUseSetup(contents: string, setupImportPath: string, moduleStyle: ModuleStyle): string {
  if (moduleStyle === "esm") {
    return replacePlaywrightImportSource(contents, setupImportPath);
  }

  return replacePlaywrightRequireSource(contents, setupImportPath);
}

function insertHelperImport(contents: string, moduleStyle: ModuleStyle): string {
  if (contents.includes(HELPER_PACKAGE_NAME)) {
    return contents;
  }

  const eol = detectEol(contents);
  const lines = contents.split(/\r?\n/);
  const insertAt = findTopLevelInsertionIndex(lines, moduleStyle);

  const statement = moduleStyle === "esm"
    ? `import { installSelectorShot } from "${HELPER_PACKAGE_NAME}";`
    : `const { installSelectorShot } = require("${HELPER_PACKAGE_NAME}");`;

  lines.splice(insertAt, 0, statement);
  return lines.join(eol);
}

function insertInstallBlock(contents: string, moduleStyle: ModuleStyle, testAccessor: string): string {
  if (contents.includes("installSelectorShot(")) {
    return contents;
  }

  const eol = detectEol(contents);
  const lines = contents.split(/\r?\n/);
  const insertAt = findTopLevelInsertionIndex(lines, moduleStyle);
  const blockLines = buildInstallBlock(testAccessor, eol).split(eol);
  const trailingSpacer = insertAt < lines.length && lines[insertAt] !== "" ? [""] : [];

  lines.splice(insertAt, 0, ...blockLines, ...trailingSpacer);
  return lines.join(eol);
}

function patchSharedEntryFile(contents: string, moduleStyle: ModuleStyle): string {
  let updated = insertHelperImport(contents, moduleStyle);
  updated = insertInstallBlock(updated, moduleStyle, "test");
  return updated;
}

function buildSetupContents(language: SourceLanguage, moduleStyle: ModuleStyle): string {
  void language;

  if (moduleStyle === "cjs") {
    return [
      `const playwright = require("${PLAYWRIGHT_PACKAGE_NAME}");`,
      `const { installSelectorShot } = require("${HELPER_PACKAGE_NAME}");`,
      "",
      "const { test, expect } = playwright;",
      "",
      DEFAULT_INSTALL_OPTIONS_BLOCK,
      "",
      "module.exports = { ...playwright, test, expect };",
      ""
    ].join("\n");
  }

  return [
    `import * as playwright from "${PLAYWRIGHT_PACKAGE_NAME}";`,
    `import { installSelectorShot } from "${HELPER_PACKAGE_NAME}";`,
    "",
    "const { test, expect } = playwright;",
    "",
    DEFAULT_INSTALL_OPTIONS_BLOCK,
    "",
    `export * from "${PLAYWRIGHT_PACKAGE_NAME}";`,
    "export { test, expect };",
    ""
  ].join("\n");
}

export function ensureSelectorShotDependency(
  workspaceRoot: string,
  packageJson?: PackageJson,
  runInstallCommand: typeof spawnSync = spawnSync
): { installed: boolean; note?: string } {
  const installCommand = buildSelectorShotInstallCommand(workspaceRoot, packageJson);
  const result = runInstallCommand(installCommand.command, installCommand.args, {
    cwd: workspaceRoot,
    encoding: "utf8",
    shell: process.platform === "win32" && /\.cmd$/i.test(installCommand.command)
  });

  if (result.status === 0) {
    return { installed: true };
  }

  const detail = [result.error?.message, result.stderr, result.stdout]
    .map((value) => (value || "").trim())
    .filter(Boolean)[0];

  if (detail) {
    return {
      installed: false,
      note:
        `Could not auto-install ${HELPER_PACKAGE_NAME} with ` +
        `"${installCommand.command} ${installCommand.args.join(" ")}". ${detail} ` +
        `Run ${installCommand.manualCommand}.`
    };
  }

  return {
    installed: false,
    note:
      `Could not auto-install ${HELPER_PACKAGE_NAME} with ` +
      `"${installCommand.command} ${installCommand.args.join(" ")}". ` +
      `Run ${installCommand.manualCommand}.`
  };
}

function buildBootstrapSummary(actionSummary: BootstrapActionSummary): string[] {
  const parts: string[] = [];

  if (actionSummary.installedDependency) {
    parts.push("installed the helper package");
  }
  if (actionSummary.createdSetupFiles > 0) {
    parts.push(`created ${actionSummary.createdSetupFiles} shared setup file${actionSummary.createdSetupFiles === 1 ? "" : "s"}`);
  }
  if (actionSummary.patchedSpecs > 0) {
    parts.push(`patched ${actionSummary.patchedSpecs} test entry point${actionSummary.patchedSpecs === 1 ? "" : "s"}`);
  }
  if (actionSummary.patchedFixtures > 0) {
    parts.push(`patched ${actionSummary.patchedFixtures} shared fixture${actionSummary.patchedFixtures === 1 ? "" : "s"}`);
  }

  return parts;
}

export function validateWorkspace(workspaceRoot: string): ValidationResult {
  const analysis = analyzeWorkspace(workspaceRoot);
  const errors = [...analysis.errors];
  const warnings = [...analysis.warnings];

  if (errors.length === 0 && !analysis.hasSelectorShotDependency) {
    errors.push(`The ${HELPER_PACKAGE_NAME} helper package is missing from package.json.`);
  }

  for (const spec of analysis.specs) {
    if (spec.directImport) {
      errors.push(
        `${summarizePath(spec.specPath, workspaceRoot)} still imports test directly from ${PLAYWRIGHT_PACKAGE_NAME}.`
      );
    }

    for (const entryImport of spec.localEntryImports) {
      if (!entryImport.resolvedPath) {
        if (entryImport.intendedSetupPath && !fileExists(entryImport.intendedSetupPath)) {
          errors.push(
            `${summarizePath(entryImport.intendedSetupPath, workspaceRoot)} is referenced as a shared test entry point but does not exist.`
          );
        }
        continue;
      }
      const entryInfo = analysis.entryFiles.get(entryImport.resolvedPath);
      if (!entryInfo || !entryInfo.usesPlaywright) {
        continue;
      }
      if (!entryInfo.wired) {
        errors.push(
          `${summarizePath(entryImport.resolvedPath, workspaceRoot)} is used as a shared test entry point but is not wired to Selector Shot.`
        );
      }
    }
  }

  const dedupedErrors = [...new Set(errors)];
  const dedupedWarnings = [...new Set(warnings)];

  if (dedupedErrors.length > 0) {
    return {
      status: "broken",
      errors: dedupedErrors,
      warnings: dedupedWarnings,
      summary: `Selector Shot wiring is broken: ${dedupedErrors.join(" ")}`
    };
  }

  if (dedupedWarnings.length > 0) {
    return {
      status: "duplicate",
      errors: [],
      warnings: dedupedWarnings,
      summary: `Selector Shot wiring has duplicates or extra setup files: ${dedupedWarnings.join(" ")}`
    };
  }

  return {
    status: "complete",
    errors: [],
    warnings: [],
    summary: "Selector Shot wiring is complete. Run: npx selector-shot-update"
  };
}

export function bootstrapWorkspace(
  workspaceRoot: string,
  options: BootstrapOptions = {}
): BootstrapResult {
  const analysis = analyzeWorkspace(workspaceRoot);

  if (analysis.errors.length > 0) {
    return {
      changedFiles: [],
      notes: [...analysis.errors],
      installedDependency: false,
      status: "failed",
      summary: `Selector Shot setup failed: ${analysis.errors[0]}`
    };
  }

  const ensureDependency = options.ensureDependency || ensureSelectorShotDependency;
  let installedDependency = false;
  const notes: string[] = [];

  if (!analysis.hasSelectorShotDependency) {
    const installResult = ensureDependency(workspaceRoot, analysis.packageJson);
    installedDependency = installResult.installed;
    if (!installResult.installed) {
      return {
        changedFiles: [],
        notes: installResult.note ? [installResult.note] : [],
        installedDependency: false,
        status: "failed",
        summary: installResult.note || `Selector Shot setup failed: could not install ${HELPER_PACKAGE_NAME}.`
      };
    }
  }

  const changedFiles = new Set<string>();
  const actionSummary: BootstrapActionSummary = {
    installedDependency,
    createdSetupFiles: 0,
    patchedSpecs: 0,
    patchedFixtures: 0
  };

  for (const group of analysis.setupGroups) {
    if (fileExists(group.setupPath)) {
      const existingInfo = analyzeEntryFile(group.setupPath, analysis.packageJson.type);
      if (!existingInfo.wired) {
        if (!existingInfo.patchable) {
          return {
            changedFiles: [...changedFiles],
            notes: [`${summarizePath(group.setupPath, workspaceRoot)} exists but could not be patched automatically.`],
            installedDependency,
            status: "failed",
            summary:
              `Selector Shot setup failed: ${summarizePath(group.setupPath, workspaceRoot)} ` +
              "exists but could not be patched automatically."
          };
        }

        const original = readText(group.setupPath);
        const updated = patchSharedEntryFile(original, existingInfo.moduleStyle);
        if (updated !== original) {
          fs.writeFileSync(group.setupPath, updated, "utf8");
          changedFiles.add(group.setupPath);
          actionSummary.patchedFixtures += 1;
        }
      }
    } else {
      fs.mkdirSync(path.dirname(group.setupPath), { recursive: true });
      fs.writeFileSync(group.setupPath, buildSetupContents(group.language, group.moduleStyle), "utf8");
      changedFiles.add(group.setupPath);
      actionSummary.createdSetupFiles += 1;
    }

    for (const specPath of group.specPaths) {
      const spec = analysis.specs.find((candidate) => candidate.specPath === specPath);
      if (!spec?.directImport) {
        continue;
      }
      const original = readText(specPath);
      const setupImportPath = toImportPath(path.dirname(specPath), group.setupPath);
      const updated = patchSpecToUseSetup(original, setupImportPath, spec.directImport.moduleStyle);
      if (updated !== original) {
        fs.writeFileSync(specPath, updated, "utf8");
        changedFiles.add(specPath);
        actionSummary.patchedSpecs += 1;
      }
    }
  }

  for (const entryInfo of analysis.entryFiles.values()) {
    if (entryInfo.wired) {
      continue;
    }
    if (!entryInfo.patchable) {
      return {
        changedFiles: [...changedFiles],
        notes: [`${summarizePath(entryInfo.filePath, workspaceRoot)} could not be patched automatically.`],
        installedDependency,
        status: "failed",
        summary:
          `Selector Shot setup failed: ${summarizePath(entryInfo.filePath, workspaceRoot)} ` +
          "could not be patched automatically."
      };
    }
    const original = readText(entryInfo.filePath);
    const updated = patchSharedEntryFile(original, entryInfo.moduleStyle);
    if (updated !== original) {
      fs.writeFileSync(entryInfo.filePath, updated, "utf8");
      changedFiles.add(entryInfo.filePath);
      actionSummary.patchedFixtures += 1;
    }
  }

  const validation = validateWorkspace(workspaceRoot);
  const changedFileList = [...changedFiles];
  const actionNotes = buildBootstrapSummary(actionSummary);

  if (validation.status === "broken") {
    return {
      changedFiles: changedFileList,
      notes: [...actionNotes, ...validation.errors],
      installedDependency,
      status: "failed",
      summary: `Selector Shot setup failed: ${validation.errors.join(" ")}`
    };
  }

  if (validation.status === "duplicate") {
    return {
      changedFiles: changedFileList,
      notes: [...actionNotes, ...validation.warnings],
      installedDependency,
      status: "partial",
      summary:
        `Selector Shot setup is complete, but wiring should be cleaned up: ` +
        `${[...actionNotes, ...validation.warnings].join("; ")}`
    };
  }

  if (changedFileList.length === 0 && !installedDependency) {
    return {
      changedFiles: [],
      notes,
      installedDependency: false,
      status: "noop",
      summary: "Selector Shot wiring already looks complete. Run: npx selector-shot-update"
    };
  }

  const summaryParts = buildBootstrapSummary(actionSummary);
  return {
    changedFiles: changedFileList,
    notes: [...notes, ...summaryParts],
    installedDependency,
    status: "success",
    summary:
      `Selector Shot setup succeeded: ${summaryParts.join("; ")}. ` +
      "Run: npx selector-shot-update"
  };
}
