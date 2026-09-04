import { useFakeAgentBin } from "./agent-bin";
import { useTestShell } from "./shell";

// Testing Library's matchers on Vitest's `expect`, and the unmount between
// tests that keeps one test's rendered tree from being found by the next.
import { afterEach, beforeEach, expect } from "vitest";
import { cleanup } from "@testing-library/react";
import * as matchers from "@testing-library/jest-dom/matchers";

expect.extend(matchers);

afterEach(cleanup);

// The rendering tests mount components and do not spawn anything today, but
// they resolve the same modules the server does and the cost of being wrong
// about that is a real agent session. The two runners agree on this rather than
// one of them being the exception nobody remembers — once at load for anything
// reading the variables at module scope, and again before every test for the
// reason `test/preload.ts` gives: a file that sets its own and never puts it
// back would otherwise leave it standing for every file after it, and the
// guard that would say so (`test-shell.test.ts`) never runs under this runner.
useFakeAgentBin();
useTestShell();
beforeEach(useFakeAgentBin);
beforeEach(useTestShell);
