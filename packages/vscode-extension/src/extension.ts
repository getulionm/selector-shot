import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { codeLensTitleForItem, formatCaptureTime, lineContainsConcreteSelectorText } from "./logic";

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

class SelectorShotLensProvider implements vscode.CodeLensProvider {
  private readonly emitter = new vscode.EventEmitter<void>();
  private readonly index = new Map<string, Map<number, LensItem>>();

  get onDidChangeCodeLenses(): vscode.Event<void> {
    return this.emitter.event;
  }

  async refreshIndex() {
    this.index.clear();
    const config = vscode.workspace.getConfiguration("selectorShot");
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

  private indexMetaFile(metaPath: string, onlyCaptured: boolean) {
    let parsed: SelectorShotMeta | null = null;
    try {
      const raw = fs.readFileSync(metaPath, "utf8");
      parsed = JSON.parse(raw) as SelectorShotMeta;
    } catch {
      return;
    }

    if (!parsed || !parsed.source || !parsed.source.filePath || !parsed.source.line || !parsed.imagePath) {
      return;
    }

    const sourcePath = normalizePath(parsed.source.filePath);
    const line = parsed.source.line;
    const createdAt = parsed.createdAt || "";
    const imagePath = path.isAbsolute(parsed.imagePath)
      ? path.normalize(parsed.imagePath)
      : path.resolve(path.dirname(metaPath), parsed.imagePath);
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
    vscode.commands.registerCommand("selectorShot.refresh", async () => {
      await provider.refreshIndex();
      vscode.window.showInformationMessage("Selector Shot index refreshed.");
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("selectorShot.openImage", async (imagePath: string, sourcePath?: string, line?: number) => {
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
