import * as fs from "node:fs";
import * as path from "node:path";

export type LensTitleInput = {
  status: string;
  createdAt: string;
};

export type PackageManagerName = "npm" | "pnpm" | "yarn" | "bun";

export type InstallCommand = {
  packageManager: PackageManagerName;
  command: string;
  args: string[];
  manualCommand: string;
};

export function lineContainsConcreteSelectorText(text: string): boolean {
  const hasStringLiteral = /(?:`[^`]*`|'[^']*'|"[^"]*")/.test(text);
  if (hasStringLiteral) {
    return true;
  }

  const hasSelectorMemberReference =
    /\b[a-zA-Z_$][\w$]*(?:\??\.[a-zA-Z_$][\w$]*|\[\s*(?:'[^']+'|"[^"]+"|`[^`]+`)\s*\])/.test(text);
  if (hasSelectorMemberReference) {
    return true;
  }

  const hasSelectorVariableArgument =
    /\b(?:locator|frameLocator|getBy(?:AltText|Label|Placeholder|Role|TestId|Text|Title))\s*\(\s*[a-zA-Z_$][\w$]*\s*(?:\)|,)/.test(
      text
    );
  return hasSelectorVariableArgument;
}

export function codeLensTitleForItem(item: LensTitleInput): string {
  const when = formatCaptureTime(item.createdAt);
  if (item.status === "failed") {
    return `Failed selector screenshot capture (${when})`;
  }
  return `Open selector screenshot (${when})`;
}

export function formatCaptureTime(createdAt: string): string {
  if (!createdAt) {
    return "unknown time";
  }

  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) {
    return createdAt;
  }

  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  });
}

export function normalizeCapturedSourcePath(filePath: string): string {
  let normalized = path.normalize(String(filePath || ""));

  if (process.platform === "win32") {
    normalized = normalized.replace(/^[A-Za-z]:\\(?=[A-Za-z]:\\)/, "");
    normalized = normalized.replace(/^\\([A-Za-z]:\\)/, "$1");
  }

  return normalized;
}

export function buildSelectorShotInstallCommand(
  workspaceRoot: string,
  packageJson?: { packageManager?: string | undefined }
): InstallCommand {
  const packageManager = detectPackageManager(workspaceRoot, packageJson?.packageManager);
  switch (packageManager) {
    case "pnpm":
      return {
        packageManager,
        command: packageManagerExecutable("pnpm"),
        args: ["add", "-D", "@getulionm/selector-shot-playwright"],
        manualCommand: "pnpm add -D @getulionm/selector-shot-playwright"
      };
    case "yarn":
      return {
        packageManager,
        command: packageManagerExecutable("yarn"),
        args: ["add", "-D", "@getulionm/selector-shot-playwright"],
        manualCommand: "yarn add -D @getulionm/selector-shot-playwright"
      };
    case "bun":
      return {
        packageManager,
        command: "bun",
        args: ["add", "-d", "@getulionm/selector-shot-playwright"],
        manualCommand: "bun add -d @getulionm/selector-shot-playwright"
      };
    case "npm":
    default:
      return {
        packageManager,
        command: packageManagerExecutable("npm"),
        args: ["install", "-D", "@getulionm/selector-shot-playwright"],
        manualCommand: "npm install -D @getulionm/selector-shot-playwright"
      };
  }
}

function detectPackageManager(workspaceRoot: string, packageManagerField?: string): PackageManagerName {
  const fromPackageManagerField = parsePackageManagerField(packageManagerField);
  if (fromPackageManagerField) {
    return fromPackageManagerField;
  }

  if (hasAnyFile(workspaceRoot, ["bun.lock", "bun.lockb"])) {
    return "bun";
  }
  if (hasAnyFile(workspaceRoot, ["pnpm-lock.yaml"])) {
    return "pnpm";
  }
  if (hasAnyFile(workspaceRoot, ["yarn.lock"])) {
    return "yarn";
  }

  return "npm";
}

function parsePackageManagerField(packageManagerField?: string): PackageManagerName | undefined {
  const normalized = (packageManagerField || "").trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (normalized.startsWith("pnpm@")) {
    return "pnpm";
  }
  if (normalized.startsWith("yarn@")) {
    return "yarn";
  }
  if (normalized.startsWith("bun@")) {
    return "bun";
  }
  if (normalized.startsWith("npm@")) {
    return "npm";
  }
  return undefined;
}

function hasAnyFile(workspaceRoot: string, names: string[]): boolean {
  return names.some((name) => fs.existsSync(path.join(workspaceRoot, name)));
}

function packageManagerExecutable(name: "npm" | "pnpm" | "yarn"): string {
  return process.platform === "win32" ? `${name}.cmd` : name;
}
