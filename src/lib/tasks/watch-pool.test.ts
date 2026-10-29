import { test, expect, describe, afterEach } from "bun:test";
import { EventEmitter } from "events";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { WatchPool, type WatchFn } from "./watch-pool";
import { TaskWatcher, type ChangeBatch } from "./watcher";
import { waitFor } from "../../../test/wait";

/** A stand-in for `fs.watch` that records what was opened and lets a test
 * fire events and errors at it. */
class FakeStream extends EventEmitter {
  closed = 0;
  constructor(
    readonly dir: string,
    readonly recursive: boolean,
    readonly listener: (event: string, filename: string | null) => void,
  ) {
    super();
  }
  emitPath(filename: string | null): void {
    this.listener("rename", filename);
  }
  close(): void {
    this.closed++;
  }
}

function fakeWatch() {
  const opened: FakeStream[] = [];
  const watch: WatchFn = (dir, options, listener) => {
    const stream = new FakeStream(dir, options.recursive, listener);
    opened.push(stream);
    return stream as unknown as fs.FSWatcher;
  };
  return { opened, watch };
}

describe("WatchPool", () => {
  test("two subscribers on one directory share one stream, and both hear it", () => {
    const { opened, watch } = fakeWatch();
    const pool = new WatchPool(watch);
    const a: string[] = [];
    const b: string[] = [];
    pool.open("/repo", true, (p) => a.push(p), () => {});
    pool.open("/repo/", true, (p) => b.push(p), () => {});

    expect(opened).toHaveLength(1);
    expect(pool.stats()).toEqual({ streams: 1, subscriptions: 2 });
    opened[0]!.emitPath("src/a.ts");
    expect(a).toEqual(["src/a.ts"]);
    expect(b).toEqual(["src/a.ts"]);
  });

  test("the same directory at a different recursion is a different stream", () => {
    const { opened, watch } = fakeWatch();
    const pool = new WatchPool(watch);
    pool.open("/repo/.git", false, () => {}, () => {});
    pool.open("/repo/.git", true, () => {}, () => {});
    expect(opened.map((s) => s.recursive)).toEqual([false, true]);
  });

  test("a null filename reaches nobody", () => {
    const { opened, watch } = fakeWatch();
    const pool = new WatchPool(watch);
    const seen: string[] = [];
    pool.open("/repo", true, (p) => seen.push(p), () => {});
    opened[0]!.emitPath(null);
    expect(seen).toEqual([]);
  });

  test("the stream outlives every subscriber but the last, and closes with it", () => {
    const { opened, watch } = fakeWatch();
    const pool = new WatchPool(watch);
    const kept: string[] = [];
    const first = pool.open("/repo", true, () => {}, () => {});
    pool.open("/repo", true, (p) => kept.push(p), () => {});

    first.close();
    first.close();
    expect(opened[0]!.closed).toBe(0);
    opened[0]!.emitPath("still.ts");
    expect(kept).toEqual(["still.ts"]);
    expect(pool.stats()).toEqual({ streams: 1, subscriptions: 1 });
  });

  test("closing the last subscriber closes the stream once, and the next open starts afresh", () => {
    const { opened, watch } = fakeWatch();
    const pool = new WatchPool(watch);
    const only = pool.open("/repo", true, () => {}, () => {});
    only.close();
    only.close();
    expect(opened[0]!.closed).toBe(1);
    expect(pool.stats()).toEqual({ streams: 0, subscriptions: 0 });

    pool.open("/repo", true, () => {}, () => {});
    expect(opened).toHaveLength(2);
  });

  test("a subscriber closed by an earlier one's callback is not called for that event", () => {
    const { opened, watch } = fakeWatch();
    const pool = new WatchPool(watch);
    const late: string[] = [];
    let second: { close(): void } | undefined;
    pool.open("/repo", true, () => second?.close(), () => {});
    second = pool.open("/repo", true, (p) => late.push(p), () => {});
    opened[0]!.emitPath("a.ts");
    expect(late).toEqual([]);
  });

  test("a subscriber that throws does not keep the event from the others, and is reported", () => {
    const { opened, watch } = fakeWatch();
    const reported: unknown[] = [];
    const pool = new WatchPool(watch, (e) => reported.push(e));
    const heard: string[] = [];
    pool.open("/repo", true, () => {
      throw new Error("boom");
    }, () => {});
    pool.open("/repo", true, (p) => heard.push(p), () => {});
    opened[0]!.emitPath("a.ts");
    expect(heard).toEqual(["a.ts"]);
    expect(reported.map((e) => (e as Error).message)).toEqual(["boom"]);
  });

  test("an onError that throws does not keep the error from the others", () => {
    const { opened, watch } = fakeWatch();
    const reported: unknown[] = [];
    const pool = new WatchPool(watch, (e) => reported.push(e));
    const errors: string[] = [];
    pool.open("/repo", true, () => {}, () => {
      throw new Error("boom");
    });
    pool.open("/repo", true, () => {}, (e) => errors.push(e.message));
    opened[0]!.emit("error", new Error("EMFILE"));
    expect(errors).toEqual(["EMFILE"]);
    expect(reported).toHaveLength(1);
  });

  test("an error reaches every subscriber, drops the stream, and a retry opens a fresh one", () => {
    const { opened, watch } = fakeWatch();
    const pool = new WatchPool(watch);
    const errors: string[] = [];
    const a = pool.open("/repo", true, () => {}, (e) => errors.push(`a:${e.message}`));
    pool.open("/repo", true, () => {}, (e) => errors.push(`b:${e.message}`));

    opened[0]!.emit("error", new Error("EMFILE"));
    expect(errors).toEqual(["a:EMFILE", "b:EMFILE"]);
    expect(opened[0]!.closed).toBe(1);
    expect(pool.stats()).toEqual({ streams: 0, subscriptions: 0 });

    // A handle from the dead stream closing late must not touch its successor.
    const retry = pool.open("/repo", true, () => {}, () => {});
    expect(opened).toHaveLength(2);
    a.close();
    expect(opened[1]!.closed).toBe(0);
    expect(pool.stats()).toEqual({ streams: 1, subscriptions: 1 });
    retry.close();
    expect(opened[1]!.closed).toBe(1);
  });

  test("a directory that cannot be watched throws and leaves nothing behind", () => {
    const pool = new WatchPool((() => {
      throw new Error("ENOENT");
    }) as WatchFn);
    expect(() => pool.open("/gone", true, () => {}, () => {})).toThrow("ENOENT");
    expect(pool.stats()).toEqual({ streams: 0, subscriptions: 0 });
  });
});

describe("TaskWatcher over a shared pool", () => {
  const dirs: string[] = [];
  const closers: { close(): void }[] = [];
  afterEach(() => {
    for (const c of closers.splice(0)) c.close();
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  // Real events, as in watcher.test.ts: the point is that two watchers on one
  // real stream each get the batch they would have got from their own.
  test("two tasks on one checkout share its stream and each gets the batch", async () => {
    const checkout = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "codetoaster-pool-")));
    dirs.push(checkout);
    const pool = new WatchPool();
    await Bun.sleep(300);
    const a: ChangeBatch[] = [];
    const b: ChangeBatch[] = [];
    const options = { settleMs: 150, maxWaitMs: 600, pool };
    const first = new TaskWatcher({ checkout, gitDirs: [] }, (x) => a.push(x), options);
    const second = new TaskWatcher({ checkout, gitDirs: [] }, (x) => b.push(x), options);
    closers.push(first, second);
    expect(pool.stats()).toEqual({ streams: 1, subscriptions: 2 });
    await Bun.sleep(100);

    fs.writeFileSync(path.join(checkout, "a.ts"), "a");
    expect(await waitFor(() => a.length > 0 && b.length > 0, 3000)).toBe(true);
    expect(a[0]).toEqual({ files: ["a.ts"], history: false });
    expect(b[0]).toEqual({ files: ["a.ts"], history: false });

    first.close();
    expect(pool.stats()).toEqual({ streams: 1, subscriptions: 1 });
    fs.writeFileSync(path.join(checkout, "b.ts"), "b");
    expect(await waitFor(() => b.length > 1, 3000)).toBe(true);
    expect(b[1]).toEqual({ files: ["b.ts"], history: false });
    expect(a).toHaveLength(1);

    second.close();
    expect(pool.stats()).toEqual({ streams: 0, subscriptions: 0 });
  });
});
