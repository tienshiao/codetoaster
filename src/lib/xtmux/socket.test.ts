import { test, expect, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { connect, type Socket } from "node:net";
import { constants as zlibConstants, inflateRawSync } from "node:zlib";
import type { Server } from "bun";
import { applyMigrations } from "../db";
import { TaskManager } from "../tasks/manager";
import { handleClientMessage } from "./client-messages";
import { terminalSocketCompression } from "./socket";
import type { WebSocketData } from "./types";
import { waitFor } from "../../../test/wait";

// The terminal socket's compression (TASK-147), against a real Bun.serve
// mounting the same options `server.ts` does and the real message handler, so
// the frame under test is one a real send site produced.

let server: Server<WebSocketData> | undefined;
const sockets: Socket[] = [];

afterEach(() => {
  for (const s of sockets) s.destroy();
  sockets.length = 0;
  server?.stop(true);
  server = undefined;
});

function startServer(): Server<WebSocketData> {
  const db = new Database(":memory:");
  applyMigrations(db);
  const manager = new TaskManager(db);
  let n = 0;
  server = Bun.serve<WebSocketData>({
    port: 0,
    fetch(req, srv) {
      if (srv.upgrade(req, { data: { clientId: `c${++n}` } })) return;
      return new Response("upgrade failed", { status: 400 });
    },
    websocket: {
      perMessageDeflate: terminalSocketCompression,
      message(ws, message) {
        handleClientMessage(manager, ws, message);
      },
    },
  });
  return server;
}

interface Frame {
  rsv1: boolean;
  payload: Buffer;
}

/** A WebSocket client written against the wire, because the assertion is
 * about the wire: whether the extension was agreed, and whether the server's
 * frames carry RSV1 (the "this one is compressed" bit). A real client decodes
 * either way and so cannot tell an uncompressed frame from a compressed one. */
async function rawClient(port: number, offerDeflate: boolean) {
  const sock = connect(port, "127.0.0.1");
  sockets.push(sock);
  let buf = Buffer.alloc(0);
  let head: string | undefined;
  const frames: Frame[] = [];
  sock.on("data", (chunk: Buffer) => {
    buf = Buffer.concat([buf, chunk]);
    if (head === undefined) {
      const end = buf.indexOf("\r\n\r\n");
      if (end < 0) return;
      head = buf.subarray(0, end).toString();
      buf = buf.subarray(end + 4);
    }
    while (buf.length >= 2) {
      let len = buf[1]! & 0x7f;
      let off = 2;
      if (len === 126) {
        if (buf.length < 4) return;
        len = buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (buf.length < 10) return;
        len = Number(buf.readBigUInt64BE(2));
        off = 10;
      }
      if (buf.length < off + len) return;
      frames.push({ rsv1: (buf[0]! & 0x40) !== 0, payload: Buffer.from(buf.subarray(off, off + len)) });
      buf = buf.subarray(off + len);
    }
  });
  await new Promise<void>((resolve) => sock.once("connect", () => resolve()));
  sock.write(
    `GET /terminal HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
      "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n" +
      (offerDeflate ? "Sec-WebSocket-Extensions: permessage-deflate; client_max_window_bits\r\n" : "") +
      "\r\n",
  );
  expect(await waitFor(() => head !== undefined)).toBe(true);

  /** One masked, uncompressed text frame — what a client may always send. */
  const sendText = (text: string) => {
    const payload = Buffer.from(text);
    expect(payload.length).toBeLessThan(126);
    const mask = Buffer.from([0x12, 0x34, 0x56, 0x78]);
    const masked = Buffer.from(payload.map((b, i) => b ^ mask[i % 4]!));
    sock.write(Buffer.concat([Buffer.from([0x81, 0x80 | payload.length]), mask, masked]));
  };
  return { head: head!, frames, sendText };
}

test("permessage-deflate is negotiated with a client that offers it, and frames are compressed", async () => {
  const srv = startServer();
  const client = await rawClient(srv.port!, true);
  expect(client.head).toMatch(/^HTTP\/1\.1 101/);
  expect(client.head).toMatch(/sec-websocket-extensions: permessage-deflate/i);

  client.sendText(JSON.stringify({ type: "list" }));
  expect(await waitFor(() => client.frames.length > 0)).toBe(true);

  const [frame] = client.frames;
  // The bit that negotiation alone does not set: Bun agrees to the extension
  // and still sends raw unless the send asks, which is what `sendFrame` is for.
  expect(frame!.rsv1).toBe(true);
  // The first message on the socket, so no earlier window to decode against.
  // RFC 7692 §7.2.2: the sender strips this trailer and the receiver puts it back.
  // Sync-flushed, not finished, so the inflater is told not to expect an end.
  const decoded = inflateRawSync(Buffer.concat([frame!.payload, Buffer.from([0x00, 0x00, 0xff, 0xff])]), {
    finishFlush: zlibConstants.Z_SYNC_FLUSH,
  });
  expect(JSON.parse(decoded.toString()).type).toBe("tasks");
});

test("a client that does not offer the extension gets plain frames it can read", async () => {
  const srv = startServer();
  const client = await rawClient(srv.port!, false);
  expect(client.head).toMatch(/^HTTP\/1\.1 101/);
  expect(client.head).not.toMatch(/sec-websocket-extensions/i);

  client.sendText(JSON.stringify({ type: "list" }));
  expect(await waitFor(() => client.frames.length > 0)).toBe(true);

  const [frame] = client.frames;
  expect(frame!.rsv1).toBe(false);
  expect(JSON.parse(frame!.payload.toString()).type).toBe("tasks");
});

test("a real WebSocket client reads the same messages either way", async () => {
  const srv = startServer();
  const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/terminal`);
  const received: string[] = [];
  ws.onmessage = (ev) => received.push(String(ev.data));
  try {
    expect(await waitFor(() => ws.readyState === WebSocket.OPEN)).toBe(true);
    // Unknown type: answered by `sendError`, the other helper-routed path.
    ws.send(JSON.stringify({ type: "nonsense" }));
    ws.send(JSON.stringify({ type: "list" }));
    expect(await waitFor(() => received.length >= 2)).toBe(true);
    expect(JSON.parse(received[0]!)).toEqual({ type: "error", message: "Unknown message type" });
    expect(JSON.parse(received[1]!).type).toBe("tasks");
  } finally {
    ws.close();
  }
});
