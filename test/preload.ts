// Loaded before every `bun test` file (bunfig.toml, `[test] preload`).
//
// Only this, and deliberately: Bun's preload is global with no per-file
// environment, which is the whole reason the rendering tests live under Vitest
// instead (CLAUDE.md, "Testing"). Anything heavier here would be paid by every
// suite, including the ones with no idea what an agent is.
import { beforeEach } from "bun:test";
import { useFakeAgentBin } from "./agent-bin";

// Once, for anything that reads the variable at module scope.
useFakeAgentBin();

// And again before every test, because setting it once is not enough. Files
// move this variable around: one `delete`s it in an `afterEach` so its
// stand-in does not leak, another sets its own and never puts it back. Either
// way the *next* file inherits something that is not the default — unset, in
// the first case, which is how a suite that looks protected starts spawning
// real agents halfway through a run.
//
// Bun runs this outer hook before a file's own, so a file that needs a
// different agent still sets it in its `beforeEach` or its test body and wins.
beforeEach(useFakeAgentBin);
