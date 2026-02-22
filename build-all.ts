// build-all.ts
import { $, build } from "bun";
import tailwind from "bun-plugin-tailwind";
// Generate route tree before building
import * as fs from "fs";
import * as path from "path";

const entrypoint = "./src/index.ts";
const outdir = "./dist-executables";
const outfile = "codetoaster";

const platforms = [
  { platform: "darwin", arch: "x64", target: "bun-darwin-x64", outfile: `${outfile}-macos-x64` },
  {
    platform: "darwin",
    arch: "arm64",
    target: "bun-darwin-arm64",
    outfile: `${outfile}-macos-arm64`,
  },
  { platform: "linux", arch: "x64", target: "bun-linux-x64", outfile: `${outfile}-linux-x64` },
  {
    platform: "win",
    arch: "x64",
    target: "bun-windows-x64",
    outfile: `${outfile}-windows-x64.exe`,
  },
];

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

console.log(`Starting cross-compilation for ${entrypoint}...`);

for (const platform of platforms) {
  const outputPath = path.join(outdir, platform.outfile);
  console.log(`Building for ${platform.target} -> ${outputPath}`);

  try {
    await build({
      entrypoints: [entrypoint],
      compile: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        target: platform.target as any,
        outfile: platform.outfile,
      },
      define: {
        __VERSION__: JSON.stringify(version),
        __GIT_HASH__: JSON.stringify(gitHash),
        "process.env.NODE_ENV": JSON.stringify("production"),
      },
      plugins: [tailwind],
      minify: true,
      bytecode: true,
      outdir,
    });
    console.log(`✅ Successfully built for ${platform.target}`);
  } catch (error) {
    console.error(`❌ Failed to build for ${platform.target}:`, error);
  }
}

console.log("All builds complete.");
