#!/usr/bin/env node

const { spawnSync } = require("node:child_process");

if (require.main === module) {
  const cliArgs = process.argv.slice(2);
  const command = cliArgs[0] || "npm";
  const commandArgs = cliArgs.length > 0 ? cliArgs.slice(1) : ["test"];

  const result = spawnSync(command, commandArgs, {
    stdio: "inherit",
    shell: true,
    env: {
      ...process.env,
      SELECTOR_SHOT_CAPTURE: "1"
    }
  });

  process.exit(result.status ?? 1);
}
