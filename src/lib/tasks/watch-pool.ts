import * as fs from "fs";
import * as path from "path";

/**
 * One `fs.watch` stream per directory, shared by every task that needs it
 * (TASK-135).
 *
 * Each live task's `TaskWatcher` covers its repository root recursively, the
 * metadata dir shallowly and `refs/` recursively. Several tasks in one
 * repository therefore asked for the same streams over and over: four tasks
 * in one checkout held four identical recursive FSEvents streams on the same
 * tree, and every worktree of a repository opened its own stream on the
 * common dir's `refs/`. The streams are the kernel resource; the per-task
 * coalescing in `TaskWatcher` is cheap, so it is the stream that is shared and
 * the fold that stays per task.
 *
 * Keyed by the resolved directory and whether it is recursive, since those are
 * the only two things that change what a stream delivers. The prefix a
 * subscriber puts on a path is its own business and stays on its side.
 */

export type WatchFn = (
  dir: string,
  options: { recursive: boolean },
  listener: (event: string, filename: string | Buffer | null) => void,
) => fs.FSWatcher;

export interface WatchSubscription {
  /** Idempotent. The stream closes with its last subscriber. */
  close(): void;
}

interface Subscriber {
  onPath: (filename: string) => void;
  onError: (error: Error) => void;
}

interface Stream {
  watcher: fs.FSWatcher;
  subscribers: Set<Subscriber>;
}

export class WatchPool {
  private readonly streams = new Map<string, Stream>();

  /**
   * `report` is where a subscriber's exception goes. Each callback is kept
   * from the others: with a stream each, a task whose callback threw took only
   * its own event down, and sharing must not let it take its neighbours' too.
   * The default rethrows on a microtask, so the exception still reaches
   * whatever reports uncaught errors, as it did before.
   */
  constructor(
    private readonly watch: WatchFn = (dir, options, listener) => fs.watch(dir, options, listener),
    private readonly report: (error: unknown) => void = (error) =>
      queueMicrotask(() => {
        throw error;
      }),
  ) {}

  /**
   * Subscribe to `dir`, opening its stream if nobody has it open yet. Throws
   * when the directory cannot be watched, with nothing left in the pool.
   *
   * `onPath` gets the filename relative to `dir` exactly as the platform gave
   * it. `onError` is called once, after the stream has been dropped from the
   * pool, so a subscriber that retries from inside it gets a fresh stream.
   */
  open(
    dir: string,
    recursive: boolean,
    onPath: (filename: string) => void,
    onError: (error: Error) => void,
  ): WatchSubscription {
    // The stream is opened on the resolved path, not on whichever spelling
    // its first subscriber happened to use, so every subscriber sharing the
    // key is watching exactly the directory the key names.
    const resolved = path.resolve(dir);
    const key = `${recursive ? "r" : "s"}:${resolved}`;
    let stream = this.streams.get(key);
    if (!stream) stream = this.start(key, resolved, recursive);
    const subscriber: Subscriber = { onPath, onError };
    stream.subscribers.add(subscriber);
    // Bound to this stream, not to the key: a subscription that outlives a
    // stream that failed must not close the one that replaced it.
    const owner = stream;
    return {
      close: () => {
        if (!owner.subscribers.delete(subscriber)) return;
        if (owner.subscribers.size > 0) return;
        if (this.streams.get(key) === owner) this.streams.delete(key);
        closeQuietly(owner.watcher);
      },
    };
  }

  /** How many streams are open and how many subscriptions they carry. */
  stats(): { streams: number; subscriptions: number } {
    let subscriptions = 0;
    for (const stream of this.streams.values()) subscriptions += stream.subscribers.size;
    return { streams: this.streams.size, subscriptions };
  }

  private start(key: string, dir: string, recursive: boolean): Stream {
    const subscribers = new Set<Subscriber>();
    const watcher = this.watch(dir, { recursive }, (_event, filename) => {
      if (filename === null) return;
      const name = String(filename);
      // Straight over the live set, with no copy per event: a `Set` iterator
      // skips an entry deleted before it is reached, so a subscriber one
      // callback closes (a task stopped by a batch it caused) does not hear
      // the rest of the event it was closed during.
      for (const subscriber of subscribers) {
        try {
          subscriber.onPath(name);
        } catch (error) {
          this.report(error);
        }
      }
    });
    const stream: Stream = { watcher, subscribers };
    watcher.on("error", (error: Error) => {
      if (this.streams.get(key) === stream) this.streams.delete(key);
      closeQuietly(watcher);
      const failed = [...subscribers];
      subscribers.clear();
      for (const subscriber of failed) {
        try {
          subscriber.onError(error);
        } catch (thrown) {
          this.report(thrown);
        }
      }
    });
    this.streams.set(key, stream);
    return stream;
  }
}

function closeQuietly(watcher: fs.FSWatcher): void {
  try {
    watcher.close();
  } catch {
    // Already gone; that is what was wanted.
  }
}

/** The daemon's pool. Every `TaskWatcher` subscribes here unless a test hands
 * it its own. */
export const watchPool = new WatchPool();
