import { build, context } from "esbuild";

const watch = process.argv.includes("--watch");

const options = {
  entryPoints: ["src/extension.ts", "src/logic.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["vscode"],
  outdir: "dist",
  sourcemap: true,
  target: "node20",
  logLevel: "info"
};

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log("Watching extension build...");
} else {
  await build(options);
}
