import { useSyncExternalStore } from "react";
import type { LoadHistoryMessage, LoadSample, LoadSampleMessage } from "@/lib/xtmux/types";

/**
 * The daemon's machine-wide load, as the socket delivers it (TASK-149).
 *
 * A module store rather than context or component state, for two reasons. The
 * history arrives once, as the socket opens, so it has to be kept by something
 * that outlives the route — `TaskShell` remounts on every navigation and would
 * be back to an empty chart until the next reconnect. And a sample lands every
 * two seconds: in a context value it would re-render everything under the
 * provider, where here it re-renders the one component that reads it.
 */

export interface SystemLoadState {
  /** Oldest first, at most `capacity` of them. */
  samples: readonly LoadSample[];
  intervalMs: number;
  capacity: number;
}

const INITIAL: SystemLoadState = { samples: [], intervalMs: 2_000, capacity: 300 };

export class SystemLoadStore {
  private state: SystemLoadState = INITIAL;
  private readonly listeners = new Set<() => void>();

  get = (): SystemLoadState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** The whole ring, on connect: replaces whatever was held. */
  replace(message: LoadHistoryMessage): void {
    this.set({
      samples: message.samples.slice(-message.capacity),
      intervalMs: message.intervalMs,
      capacity: message.capacity,
    });
  }

  /** One tick. A sample no newer than the last one held is dropped: it can
   * only be one the history already carried. */
  append(message: LoadSampleMessage): void {
    const { samples, capacity } = this.state;
    const last = samples.at(-1);
    if (last && message.sample.at <= last.at) return;
    const next = [...samples, message.sample];
    this.set({ ...this.state, samples: next.length > capacity ? next.slice(-capacity) : next });
  }

  /** The socket dropped. What is held stops being current the moment it does,
   * and an indicator still showing it would be a stale figure dressed as a
   * live one; the reconnect's history puts it all back. */
  reset(): void {
    if (this.state.samples.length === 0) return;
    this.set({ ...this.state, samples: [] });
  }

  private set(state: SystemLoadState): void {
    this.state = state;
    for (const listener of [...this.listeners]) listener();
  }
}

export const systemLoad = new SystemLoadStore();

export function useSystemLoad(store: SystemLoadStore = systemLoad): SystemLoadState {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
