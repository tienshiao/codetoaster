import { test, expect, describe } from "bun:test";
import { withRepoLock } from "./lock";

/** A promise a test can settle when it chooses, so overlap is observed rather
 * than raced against a timer. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe("withRepoLock", () => {
  test("a second operation on one repository waits for the first", async () => {
    const gate = deferred<void>();
    const order: string[] = [];

    const first = withRepoLock("/repo", async () => {
      order.push("first:start");
      await gate.promise;
      order.push("first:end");
    });
    const second = withRepoLock("/repo", async () => { order.push("second:start"); });

    // Nothing of the second has run while the first is still inside.
    await Promise.resolve();
    expect(order).toEqual(["first:start"]);

    gate.resolve();
    await Promise.all([first, second]);
    expect(order).toEqual(["first:start", "first:end", "second:start"]);
  });

  test("different repositories do not wait for each other", async () => {
    const gate = deferred<void>();
    const order: string[] = [];

    const held = withRepoLock("/one", async () => { await gate.promise; order.push("one"); });
    await withRepoLock("/two", async () => { order.push("two"); });

    // The one that had nothing to wait for finished first, with the other
    // still inside its critical section. Two repositories share no locks and
    // no branch namespace, so serializing them would only cost throughput.
    expect(order).toEqual(["two"]);
    gate.resolve();
    await held;
  });

  test("a failed operation does not wedge the queue behind it", async () => {
    const failure = withRepoLock("/repo", async () => { throw new Error("worktree add failed"); });

    // The caller sees its own rejection...
    await expect(failure).rejects.toThrow("worktree add failed");
    // ...and the next create still runs. A create that failed is not a reason
    // to refuse the one after it.
    expect(await withRepoLock("/repo", async () => "ran")).toBe("ran");
  });

  test("results belong to their own callers", async () => {
    const results = await Promise.all([
      withRepoLock("/repo", async () => 1),
      withRepoLock("/repo", async () => 2),
      withRepoLock("/repo", async () => 3),
    ]);

    expect(results).toEqual([1, 2, 3]);
  });
});
