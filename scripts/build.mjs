// Builds the React app into web/dist with esbuild.
//   node scripts/build.mjs           production build (minified)
//   node scripts/build.mjs --watch   rebuild on every change while developing
import { cpSync, mkdirSync, rmSync } from "node:fs";
import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");
const outdir = "web/dist";

rmSync(outdir, { recursive: true, force: true });
mkdirSync(`${outdir}/assets`, { recursive: true });
cpSync("web/index.html", `${outdir}/index.html`);
cpSync("web/public", outdir, { recursive: true });

const options = {
  entryPoints: { main: "web/src/main.tsx" },
  outdir: `${outdir}/assets`,
  bundle: true,
  format: "esm",
  target: ["es2022"],
  jsx: "automatic",
  minify: !watch,
  sourcemap: true,
  define: { "process.env.NODE_ENV": JSON.stringify(watch ? "development" : "production") },
  logLevel: "info",
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log("Watching web/src for changes...");
} else {
  const result = await esbuild.build({ ...options, metafile: true });
  const sizes = Object.entries(result.metafile.outputs)
    .filter(([file]) => !file.endsWith(".map"))
    .map(([file, info]) => `${file} ${(info.bytes / 1024).toFixed(1)} KB`);
  console.log(sizes.join("\n"));
}
