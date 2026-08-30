import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

/**
 * The rendering tests only.
 *
 * `bun test` owns everything else and is the default; this exists because a
 * test that mounts a component needs a DOM, and Bun's `preload` is global —
 * there is no per-file environment, so the only way to give the frontend a
 * `document` from inside `bun test` is to give the server one too and then
 * hand its `fetch`/`Response` back. Scoping by runner is the honest version of
 * that: the server tests never see a DOM at all.
 *
 * The boundary is `*.render.tsx` — "does it render", not "is it frontend". The
 * suffix deliberately omits `.test`, because Bun requires `.test`/`.spec` in a
 * filename to discover a file: that is what keeps these invisible to `bun test`
 * with no ignore flag to maintain. Do not rename them to `*.test.tsx`.
 *
 * The pure frontend suites (parseDiff, commitGraph, layout-store, drag,
 * view-state-store, …) stay on `bun test`, where they need no DOM and no second
 * module resolver.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Mirrors `paths` in tsconfig.json. If one moves, the other has to: a
      // test resolving a module differently from the app that ships is the one
      // real hazard of running two bundlers over one tree.
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    include: ["src/**/*.render.tsx"],
    environment: "happy-dom",
    setupFiles: ["./test/setup-rendering.ts"],
    restoreMocks: true,
  },
});
