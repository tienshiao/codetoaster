// A registry of change listeners keyed by something — a pane id, a slot's
// field. Two stores wanted the identical Map-of-Sets and grew their own copy of
// it; the shape is small, but the two things that are easy to get wrong about it
// are documented here once rather than in each store.

type Listener = () => void;

export interface KeyedListeners<K> {
  /** Hear about `key` changing. Returns the unsubscribe. */
  subscribe(key: K, listener: Listener): () => void;
  /** Wake everything reading `key`, and nothing else. */
  notify(key: K): void;
  /** How many listeners `key` has — for a test that wants an unmount which
   * fails to unsubscribe to be a visible number rather than a slow leak. */
  count(key: K): number;
  /** Forget every subscriber. Test-only: module state outlives a test. */
  clear(): void;
}

export function createKeyedListeners<K>(): KeyedListeners<K> {
  const listeners = new Map<K, Set<Listener>>();

  return {
    subscribe(key, listener) {
      let set = listeners.get(key);
      if (!set) {
        set = new Set();
        listeners.set(key, set);
      }
      set.add(listener);
      return () => {
        const current = listeners.get(key);
        if (!current) return;
        current.delete(listener);
        // Dropped when empty, so a key nobody reads any more — a pane closed
        // for the session — leaves no entry behind for the next notify to walk.
        if (current.size === 0) listeners.delete(key);
      };
    },

    notify(key) {
      const set = listeners.get(key);
      if (!set || set.size === 0) return;
      // Copied: a listener may unsubscribe (a pane unmounting) mid-walk, and
      // deleting from the Set being iterated would cost the next listener.
      for (const listener of [...set]) listener();
    },

    count(key) {
      return listeners.get(key)?.size ?? 0;
    },

    clear() {
      listeners.clear();
    },
  };
}
