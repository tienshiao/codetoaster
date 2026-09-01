/**
 * A `localStorage` stand-in, because `bun test` has no DOM.
 *
 * The stores under `src/frontend` are written to survive a missing or throwing
 * `localStorage` — a private window with site data blocked throws rather than
 * no-ops — so a test that cannot produce all three states is not testing the
 * part of them that exists for that reason. Shared rather than copied into each
 * store's test: the throwing stub in particular is easy to write as one that
 * throws from `setItem` only, and then the `getItem` guard goes untested.
 */

/** Install a working stub. Returns the map behind it, for direct inspection. */
export function installStorage(): Map<string, string> {
  const data = new Map<string, string>();
  const stub: Storage = {
    get length() {
      return data.size;
    },
    clear() {
      data.clear();
    },
    getItem(key: string) {
      return data.get(key) ?? null;
    },
    key(index: number) {
      return [...data.keys()][index] ?? null;
    },
    removeItem(key: string) {
      data.delete(key);
    },
    setItem(key: string, value: string) {
      data.set(key, String(value));
    },
  };
  define(stub);
  return data;
}

/** Install one that throws from every method, as a blocked browser does. */
export function installBrokenStorage(): void {
  const blocked = () => {
    throw new Error("blocked");
  };
  define({
    length: 0,
    clear() {},
    getItem: blocked,
    key: blocked,
    removeItem: blocked,
    setItem: blocked,
  } as Storage);
}

/** Take `localStorage` away entirely, as a non-browser runtime has it. */
export function removeStorage(): void {
  Reflect.deleteProperty(globalThis, "localStorage");
}

function define(value: Storage): void {
  Object.defineProperty(globalThis, "localStorage", {
    value,
    writable: true,
    configurable: true,
  });
}
