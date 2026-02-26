const fs = require("node:fs");
const path = require("node:path");
const { runTests } = require("@vscode/test-electron");

const extensionDevelopmentPath = path.resolve(__dirname, "..");
const extensionTestsPath = path.resolve(__dirname, "suite", "index.js");
const workspacePath = path.resolve(__dirname, "fixtures", "workspace");

const localVsCodeCliPath = path.join(process.env.LOCALAPPDATA || "", "Programs", "Microsoft VS Code", "bin", "code.cmd");
const vscodeExecutablePath = fs.existsSync(localVsCodeCliPath) ? localVsCodeCliPath : undefined;

async function main() {
  try {
    await runTests({
      vscodeExecutablePath,
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [workspacePath]
    });
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

main();
