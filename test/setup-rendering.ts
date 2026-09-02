import { useFakeAgentBin } from "./agent-bin";
import { useTestShell } from "./shell";

// Testing Library's matchers on Vitest's `expect`, and the unmount between
// tests that keeps one test's rendered tree from being found by the next.
import { afterEach, expect } from "vitest";
import { cleanup } from "@testing-library/react";
import * as matchers from "@testing-library/jest-dom/matchers";

expect.extend(matchers);

afterEach(cleanup);

// The rendering tests mount components and do not spawn anything today, but
// they resolve the same modules the server does and the cost of being wrong
// about that is a real agent session. The two runners agree on this rather than
// one of them being the exception nobody remembers.
useFakeAgentBin();
useTestShell();
