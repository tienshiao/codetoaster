// Compile the app's Tailwind 4 stylesheet into a static file the converter can ship.
//
// CodeToaster has no library build, so there is no compiled stylesheet to point
// cfg.cssEntry at - src/frontend/index.css is Tailwind *source* (`@import
// "tailwindcss"`). This script produces the compiled artifact, via
// tailwind-entry.css so that .design-sync/previews/ is scanned too.
//
// The font rewrite matters: the converter resolves @font-face url()s relative to
// the stylesheet's OWN directory (extractFonts(cssPath, dirname(cssPath), ...)),
// so index.css's `url("./fonts/X.woff2")` - correct relative to src/frontend -
// would resolve into the cache dir and the Nerd Font faces would ship dangling.
// Repointing them at the real source dir lets the converter copy them into fonts/.
//
// Re-sync: this is cfg.buildCmd - run it before package-build.mjs.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = dirname(here);
const IN = `${here}/tailwind-entry.css`;
const OUT = `${here}/.cache/tailwind.css`;
const CLI = `${repo}/.ds-sync/node_modules/@tailwindcss/cli/dist/index.mjs`;

mkdirSync(dirname(OUT), { recursive: true });
execFileSync(process.execPath, [CLI, '-i', IN, '-o', OUT], { stdio: 'inherit' });

// `./fonts/X.woff2` (relative to src/frontend) -> relative to the compiled file.
const toFonts = relative(dirname(OUT), `${repo}/src/frontend/fonts`);
const css = readFileSync(OUT, 'utf8');
const fixed = css.replace(/url\((['"]?)\.\/fonts\//g, `url($1${toFonts}/`);
writeFileSync(OUT, fixed);

const n = (css.match(/url\((['"]?)\.\/fonts\//g) ?? []).length;
console.error(`build-css: ${OUT} (${(fixed.length / 1024) | 0} KB, ${n} font url(s) repointed)`);
