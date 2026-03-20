import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import {
  codeLensTitleForItem,
  formatCaptureTime,
  lineContainsConcreteSelectorText,
  normalizeCapturedSourcePath
} from "./logic";
import {
  type BootstrapResult,
  bootstrapWorkspace as runBootstrapWorkspace,
  validateWorkspace as runValidateWorkspace
} from "./bootstrap";

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
      sourcePath: normalizeCapturedSourcePath(parsed.source.filePath),
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

function showBootstrapResult(
  bootstrap: BootstrapResult
) {
  if (bootstrap.status === "failed") {
    void vscode.window.showErrorMessage(bootstrap.summary);
    return;
  }
  if (bootstrap.status === "partial") {
    void vscode.window.showWarningMessage(bootstrap.summary);
    return;
  }
  void vscode.window.showInformationMessage(bootstrap.summary);
}

function showValidationResult(
  validation: { status: "complete" | "duplicate" | "broken"; summary: string },
  action: "validate" | "enable"
) {
  const message = action === "enable"
    ? `Selector Shot enabled for this workspace. ${validation.summary}`
    : validation.summary;

  if (validation.status === "broken") {
    void vscode.window.showErrorMessage(message);
    return;
  }
  if (validation.status === "duplicate") {
    void vscode.window.showWarningMessage(message);
    return;
  }
  void vscode.window.showInformationMessage(message);
}

function setupFailedWithoutWorkspace(): BootstrapResult {
  return {
    changedFiles: [],
    notes: ["No workspace folder is open, so setup was skipped."],
    installedDependency: false,
    status: "failed",
    summary: "Selector Shot setup failed: no workspace folder is open."
  };
}

function validationFailedWithoutWorkspace() {
  return {
    status: "broken" as const,
    errors: ["No workspace folder is open."],
    warnings: [],
    summary: "Selector Shot wiring is broken: no workspace folder is open."
  };
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
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      const bootstrap = workspaceRoot ? runBootstrapWorkspace(workspaceRoot) : setupFailedWithoutWorkspace();
      showBootstrapResult(bootstrap);
    }),
    vscode.commands.registerCommand("selectorShot.validate", async () => {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      const validation = workspaceRoot ? runValidateWorkspace(workspaceRoot) : validationFailedWithoutWorkspace();
      showValidationResult(validation, "validate");
    }),
    vscode.commands.registerCommand("selectorShot.enable", async () => {
      await vscode.workspace.getConfiguration("selectorShot").update("enabled", true, vscode.ConfigurationTarget.Workspace);
      await provider.refreshIndex();
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      const validation = workspaceRoot ? runValidateWorkspace(workspaceRoot) : validationFailedWithoutWorkspace();
      showValidationResult(validation, "enable");
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
