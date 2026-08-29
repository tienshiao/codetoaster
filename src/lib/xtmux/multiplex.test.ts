import { test, expect, describe, afterEach } from "bun:test";
import type { ServerWebSocket } from "bun";
import { PtyManager } from "./pty-manager";
import type { ServerMessage, WebSocketData } from "./types";

const SHELL = [process.env.SHELL || "bash"];

// A client socket that records what the server sent it. Standing in for a
// browser tab: the thing under test is addressing and negotiation, not the
// socket.
function fakeClient() {
  const received: ServerMessage[] = [];
  const ws = {
    send: (data: string) => { received.push(JSON.parse(data)); },
  } as unknown as ServerWebSocket<WebSocketData>;
  return {
    ws,
    received,
    of: (type: string) => received.filter((m) => m.type === type) as any[],
    ptyIdsSeen: (type: string) =>
      new Set(received.filter((m) => m.type === type).map((m: any) => m.ptyId)),
  };
}

async function waitFor(predicate: () => boolean, ms = 4000): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return predicate();
}

const managers: PtyManager[] = [];
function newManager(): PtyManager {
  const m = new PtyManager();
  managers.push(m);
  return m;
}

// Two shells, sized alike unless a test says otherwise.
function twoPtys(m: PtyManager, cols = 80, rows = 24) {
  m.spawn(SHELL, { id: "a", cols, rows });
  m.spawn(SHELL, { id: "b", cols, rows });
}

afterEach(() => {
  // PTYs are real processes; a leaked one outlives the test run.
  for (const m of managers) m.killAll();
  managers.length = 0;
});

describe("spawning", () => {
  test("a PTY takes the id it was given, and one is minted otherwise", () => {
    const m = newManager();
    expect(m.spawn(SHELL, { id: "a" }).id).toBe("a");
    const minted = m.spawn(SHELL);
    expect(minted.id).not.toBe("a");
    expect(m.get(minted.id)).toBe(minted);
    expect(m.ids().sort()).toEqual(["a", minted.id].sort());
  });

  test("a duplicate id is refused rather than orphaning the running PTY", () => {
    const m = newManager();
    m.spawn(SHELL, { id: "a" });
    expect(() => m.spawn(SHELL, { id: "a" })).toThrow(/already exists/);
  });

  test("a missing or garbage size falls back instead of failing the spawn", () => {
    const m = newManager();
    expect(m.spawn(SHELL, { id: "a" }).getSize()).toEqual({ cols: 80, rows: 24 });
    expect(m.spawn(SHELL, { id: "b", cols: NaN, rows: 0 }).getSize()).toEqual({ cols: 80, rows: 24 });
  });
});

describe("one client, many PTYs", () => {
  test("attaching a second PTY does not detach the first", async () => {
    const m = newManager();
    twoPtys(m);
    const client = fakeClient();

    m.attach("a", "c1", client.ws, 80, 24);
    m.attach("b", "c1", client.ws, 80, 24);

    // v1 detached the previous session here, which is exactly what tabs cannot
    // tolerate: a background terminal must keep streaming while you read another.
    expect(m.clientPtyIds("c1").sort()).toEqual(["a", "b"]);
    expect(m.get("a")!.getClientCount()).toBe(1);
    expect(m.get("b")!.getClientCount()).toBe(1);
  });

  test("output from both PTYs reaches the client, each naming its PTY", async () => {
    const m = newManager();
    twoPtys(m);
    const client = fakeClient();
    m.attach("a", "c1", client.ws, 80, 24);
    m.attach("b", "c1", client.ws, 80, 24);

    m.get("a")!.write("echo alpha\n");
    m.get("b")!.write("echo beta\n");

    const sawBoth = await waitFor(() => {
      const ids = client.ptyIdsSeen("data");
      return ids.has("a") && ids.has("b");
    });
    expect(sawBoth).toBe(true);

    // Every terminal-addressed message carries its PTY, so a client with
    // several terminals open can route without guessing.
    for (const type of ["restore", "data"]) {
      for (const msg of client.of(type)) expect(typeof msg.ptyId).toBe("string");
    }
  });

  test("input reaches only the named PTY, and only if attached", async () => {
    const m = newManager();
    twoPtys(m);
    const client = fakeClient();
    m.attach("a", "c1", client.ws, 80, 24);

    expect(m.forClient("c1", "a")).toBeDefined();
    // Naming a PTY it never attached to must not hand the client a writable
    // one — attachment is the authorization.
    expect(m.forClient("c1", "b")).toBeUndefined();
    expect(m.forClient("nobody", "a")).toBeUndefined();

    // write() and resize() are built on that check and report the refusal, so
    // a caller can say "not attached" rather than dropping the keystroke.
    expect(m.write("c1", "a", "x")).toBe(true);
    expect(m.write("c1", "b", "x")).toBe(false);
    expect(m.write("nobody", "a", "x")).toBe(false);
    expect(m.resize("c1", "b", 100, 30)).toBe(false);
    expect(m.get("b")!.getSize()).toEqual({ cols: 80, rows: 24 });
  });

  test("detaching one PTY leaves the others attached", async () => {
    const m = newManager();
    twoPtys(m);
    const client = fakeClient();
    m.attach("a", "c1", client.ws, 80, 24);
    m.attach("b", "c1", client.ws, 80, 24);

    m.detach("c1", "a");
    expect(m.clientPtyIds("c1")).toEqual(["b"]);
    expect(m.get("a")!.getClientCount()).toBe(0);

    // No ptyId means the socket is going away: drop everything.
    m.detach("c1");
    expect(m.clientPtyIds("c1")).toEqual([]);
    expect(m.get("b")!.getClientCount()).toBe(0);
  });

  test("killing a PTY forgets it without disturbing the client's others", async () => {
    const m = newManager();
    twoPtys(m);
    const client = fakeClient();
    m.attach("a", "c1", client.ws, 80, 24);
    m.attach("b", "c1", client.ws, 80, 24);

    expect(m.kill("a")).toBe(true);
    expect(m.clientPtyIds("c1")).toEqual(["b"]);
    expect(m.get("a")).toBeUndefined();
    expect(m.kill("a")).toBe(false);
  });
});

describe("size negotiation across tabs and clients", () => {
  test("smallest measured size wins across two clients", async () => {
    const m = newManager();
    m.spawn(SHELL, { id: "a", cols: 80, rows: 24 });
    const wide = fakeClient();
    const narrow = fakeClient();

    m.attach("a", "wide", wide.ws, 120, 40);
    m.attach("a", "narrow", narrow.ws, 80, 24);

    expect(m.get("a")!.getSize()).toEqual({ cols: 80, rows: 24 });
  });

  test("a hidden tab reports null and stops constraining the size", async () => {
    const m = newManager();
    m.spawn(SHELL, { id: "a", cols: 80, rows: 24 });
    const wide = fakeClient();
    const narrow = fakeClient();
    m.attach("a", "wide", wide.ws, 120, 40);
    m.attach("a", "narrow", narrow.ws, 80, 24);
    expect(m.get("a")!.getSize()).toEqual({ cols: 80, rows: 24 });

    // The narrow client's tab was hidden: it keeps its attachment (and its
    // stream) but must stop imposing a layout it is no longer showing.
    m.resize("narrow", "a", null, null);
    expect(m.get("a")!.getSize()).toEqual({ cols: 120, rows: 40 });
  });

  test("an unmeasured attachment never constrains negotiation", async () => {
    const m = newManager();
    m.spawn(SHELL, { id: "a", cols: 100, rows: 30 });
    const measured = fakeClient();
    const unmeasured = fakeClient();

    m.attach("a", "measured", measured.ws, 100, 30);
    m.attach("a", "unmeasured", unmeasured.ws, undefined, undefined);

    expect(m.get("a")!.getSize()).toEqual({ cols: 100, rows: 30 });
  });

  test("garbage sizes are ignored, not treated as a measurement", async () => {
    const m = newManager();
    m.spawn(SHELL, { id: "a", cols: 100, rows: 30 });
    const client = fakeClient();
    m.attach("a", "c1", client.ws, 100, 30);

    m.resize("c1", "a", NaN as any, 30);
    m.resize("c1", "a", 0 as any, 0 as any);
    expect(m.get("a")!.getSize()).toEqual({ cols: 100, rows: 30 });
  });

  test("a PTY with no viewers keeps its last size", async () => {
    const m = newManager();
    m.spawn(SHELL, { id: "a", cols: 80, rows: 24 });
    const client = fakeClient();
    m.attach("a", "c1", client.ws, 90, 30);
    expect(m.get("a")!.getSize()).toEqual({ cols: 90, rows: 30 });

    // Everyone closes the tab. An agent working unwatched must not have its
    // grid collapse — this is what makes an unattended task safe to leave.
    m.detach("c1");
    expect(m.get("a")!.getSize()).toEqual({ cols: 90, rows: 30 });
  });

  test("detaching the narrow client re-widens the PTY", async () => {
    const m = newManager();
    m.spawn(SHELL, { id: "a", cols: 80, rows: 24 });
    const wide = fakeClient();
    const narrow = fakeClient();
    m.attach("a", "wide", wide.ws, 120, 40);
    m.attach("a", "narrow", narrow.ws, 80, 24);

    m.detach("narrow", "a");
    expect(m.get("a")!.getSize()).toEqual({ cols: 120, rows: 40 });
  });
});
