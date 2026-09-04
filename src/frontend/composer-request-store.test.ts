import { test, expect, beforeEach } from "bun:test";
import {
  getComposerRequest,
  requestComposerProject,
  resetComposerRequest,
  subscribeComposerRequest,
} from "./composer-request-store";

/**
 * The store behind a project group's `+` (TASK-82). No component here — what
 * this file is about is the counting, which is the whole reason the request
 * does not travel in the URL.
 */

beforeEach(() => {
  resetComposerRequest();
});

test("nothing has been asked for until something is", () => {
  expect(getComposerRequest()).toEqual({ projectId: null, seq: 0 });
});

test("the same project asked for twice is two requests", () => {
  requestComposerProject("web");
  const first = getComposerRequest();
  requestComposerProject("web");

  // The point of the count: by id alone the second press is indistinguishable
  // from no press at all, which is exactly how the button came to read as
  // inert.
  expect(getComposerRequest().projectId).toBe("web");
  expect(getComposerRequest().seq).toBe(first.seq + 1);
});

test("the snapshot is replaced only by a request", () => {
  // `useSyncExternalStore` compares it by identity, so a fresh object per read
  // would re-render the composer on every check.
  expect(getComposerRequest()).toBe(getComposerRequest());
});

test("subscribers are notified, and stop being once they unsubscribe", () => {
  let calls = 0;
  const unsubscribe = subscribeComposerRequest(() => {
    calls += 1;
  });

  requestComposerProject("web");
  expect(calls).toBe(1);

  unsubscribe();
  requestComposerProject("general");
  expect(calls).toBe(1);
  // The request itself still landed — unsubscribing is one listener leaving,
  // not the store going quiet.
  expect(getComposerRequest().projectId).toBe("general");
});

test("a reset puts the count back where a fresh page starts", () => {
  requestComposerProject("web");
  resetComposerRequest();

  expect(getComposerRequest()).toEqual({ projectId: null, seq: 0 });
});
