import { test, expect, describe, afterEach } from "bun:test";
import type { ServerWebSocket } from "bun";
import { SessionManager } from "./session-manager";
import type { ServerMessage, WebSocketData } from "./types";

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

const managers: SessionManager[] = [];
function newManager(): SessionManager {
  const m = new SessionManager();
  managers.push(m);
  return m;
}

afterEach(() => {
  // PTYs are real processes; a leaked one outlives the test run.
  for (const m of managers) {
    for (const s of m.listSessions()) m.killSession(s.id);
  }
  managers.length = 0;
});

describe("one client, many sessions", () => {
  test("attaching a second session does not detach the first", async () => {
    const m = newManager();
    await m.createSession("a", "a", 80, 24);
    await m.createSession("b", "b", 80, 24);
    const client = fakeClient();

    m.attachClient("a", "c1", client.ws, 80, 24);
    m.attachClient("b", "c1", client.ws, 80, 24);

    // v1 detached the previous session here, which is exactly what tabs cannot
    // tolerate: a background terminal must keep streaming while you read another.
    expect(m.getClientSessionIds("c1").sort()).toEqual(["a", "b"]);
    expect(m.getSession("a")!.getClientCount()).toBe(1);
    expect(m.getSession("b")!.getClientCount()).toBe(1);
  });

  test("output from both sessions reaches the client, each naming its session", async () => {
    const m = newManager();
    await m.createSession("a", "a", 80, 24);
    await m.createSession("b", "b", 80, 24);
    const client = fakeClient();
    m.attachClient("a", "c1", client.ws, 80, 24);
    m.attachClient("b", "c1", client.ws, 80, 24);

    m.getSession("a")!.write("echo alpha\n");
    m.getSession("b")!.write("echo beta\n");

    const sawBoth = await waitFor(() => {
      const ids = client.ptyIdsSeen("data");
      return ids.has("a") && ids.has("b");
    });
    expect(sawBoth).toBe(true);

    // Every terminal-addressed message carries its session, so a client with
    // several terminals open can route without guessing.
    for (const type of ["restore", "data"]) {
      for (const msg of client.of(type)) expect(typeof msg.ptyId).toBe("string");
    }
  });

  test("input reaches only the named session, and only if attached", async () => {
    const m = newManager();
    await m.createSession("a", "a", 80, 24);
    await m.createSession("b", "b", 80, 24);
    const client = fakeClient();
    m.attachClient("a", "c1", client.ws, 80, 24);

    expect(m.getClientSession("c1", "a")).toBeDefined();
    // Naming a session it never attached to must not hand the client a writable
    // PTY — attachment is the authorization.
    expect(m.getClientSession("c1", "b")).toBeUndefined();
    expect(m.getClientSession("nobody", "a")).toBeUndefined();
  });

  test("detaching one session leaves the others attached", async () => {
    const m = newManager();
    await m.createSession("a", "a", 80, 24);
    await m.createSession("b", "b", 80, 24);
    const client = fakeClient();
    m.attachClient("a", "c1", client.ws, 80, 24);
    m.attachClient("b", "c1", client.ws, 80, 24);

    m.detachClient("c1", "a");
    expect(m.getClientSessionIds("c1")).toEqual(["b"]);
    expect(m.getSession("a")!.getClientCount()).toBe(0);

    // No ptyId means the socket is going away: drop everything.
    m.detachClient("c1");
    expect(m.getClientSessionIds("c1")).toEqual([]);
    expect(m.getSession("b")!.getClientCount()).toBe(0);
  });

  test("killing a session forgets it without disturbing the client's others", async () => {
    const m = newManager();
    await m.createSession("a", "a", 80, 24);
    await m.createSession("b", "b", 80, 24);
    const client = fakeClient();
    m.attachClient("a", "c1", client.ws, 80, 24);
    m.attachClient("b", "c1", client.ws, 80, 24);

    m.killSession("a");
    expect(m.getClientSessionIds("c1")).toEqual(["b"]);
  });
});

describe("size negotiation across tabs and clients", () => {
  test("smallest measured size wins across two clients", async () => {
    const m = newManager();
    await m.createSession("a", "a", 80, 24);
    const wide = fakeClient();
    const narrow = fakeClient();

    m.attachClient("a", "wide", wide.ws, 120, 40);
    m.attachClient("a", "narrow", narrow.ws, 80, 24);

    expect(m.getSession("a")!.getSize()).toEqual({ cols: 80, rows: 24 });
  });

  test("a hidden tab reports null and stops constraining the size", async () => {
    const m = newManager();
    await m.createSession("a", "a", 80, 24);
    const wide = fakeClient();
    const narrow = fakeClient();
    m.attachClient("a", "wide", wide.ws, 120, 40);
    m.attachClient("a", "narrow", narrow.ws, 80, 24);
    expect(m.getSession("a")!.getSize()).toEqual({ cols: 80, rows: 24 });

    // The narrow client's tab was hidden: it keeps its attachment (and its
    // stream) but must stop imposing a layout it is no longer showing.
    m.getSession("a")!.updateClientSize("narrow", null, null);
    expect(m.getSession("a")!.getSize()).toEqual({ cols: 120, rows: 40 });
  });

  test("an unmeasured attachment never constrains negotiation", async () => {
    const m = newManager();
    await m.createSession("a", "a", 100, 30);
    const measured = fakeClient();
    const unmeasured = fakeClient();

    m.attachClient("a", "measured", measured.ws, 100, 30);
    m.attachClient("a", "unmeasured", unmeasured.ws, undefined, undefined);

    expect(m.getSession("a")!.getSize()).toEqual({ cols: 100, rows: 30 });
  });

  test("garbage sizes are ignored, not treated as a measurement", async () => {
    const m = newManager();
    await m.createSession("a", "a", 100, 30);
    const client = fakeClient();
    m.attachClient("a", "c1", client.ws, 100, 30);

    m.getSession("a")!.updateClientSize("c1", NaN as any, 30);
    m.getSession("a")!.updateClientSize("c1", 0 as any, 0 as any);
    expect(m.getSession("a")!.getSize()).toEqual({ cols: 100, rows: 30 });
  });

  test("a session with no viewers keeps its last size", async () => {
    const m = newManager();
    await m.createSession("a", "a", 80, 24);
    const client = fakeClient();
    m.attachClient("a", "c1", client.ws, 90, 30);
    expect(m.getSession("a")!.getSize()).toEqual({ cols: 90, rows: 30 });

    // Everyone closes the tab. An agent working unwatched must not have its
    // grid collapse — this is what makes an unattended task safe to leave.
    m.detachClient("c1");
    expect(m.getSession("a")!.getSize()).toEqual({ cols: 90, rows: 30 });
  });

  test("detaching the narrow client re-widens the session", async () => {
    const m = newManager();
    await m.createSession("a", "a", 80, 24);
    const wide = fakeClient();
    const narrow = fakeClient();
    m.attachClient("a", "wide", wide.ws, 120, 40);
    m.attachClient("a", "narrow", narrow.ws, 80, 24);

    m.detachClient("narrow", "a");
    expect(m.getSession("a")!.getSize()).toEqual({ cols: 120, rows: 40 });
  });
});
