// Testing Library's matchers on Bun's `expect`, and the unmount-between-tests
// that keeps one test's rendered tree from being found by the next.
import { afterEach, expect } from "bun:test";
import { cleanup } from "@testing-library/react";
import * as matchers from "@testing-library/jest-dom/matchers";

expect.extend(matchers as Parameters<typeof expect.extend>[0]);

afterEach(cleanup);
