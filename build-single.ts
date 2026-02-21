// build-single.ts - Build a single binary for the current platform
import { $, build } from "bun";
import tailwind from "bun-plugin-tailwind";
import * as fs from "fs";

const entrypoint = "./src/index.ts";
const outdir = "./dist-executables";
const outfile = "server";

// Generate route tree
await $`bunx tsr generate`;

// Get version info
const packageJson = await Bun.file("./package.json").json();
const version = packageJson.version;
const gitHash = (await $`git rev-parse --short HEAD`.text()).trim();

console.log(`Building version ${version} (${gitHash})`);

// Ensure the output directory exists
if (!fs.existsSync(outdir)) {
  fs.mkdirSync(outdir, { recursive: true });
}

await build({
  entrypoints: [entrypoint],
  compile: {
    outfile: `${outdir}/${outfile}`,
  },
  define: {
    __VERSION__: JSON.stringify(version),
    __GIT_HASH__: JSON.stringify(gitHash),
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  plugins: [tailwind],
  minify: true,
});

console.log(`Built ${outdir}/${outfile}`);
