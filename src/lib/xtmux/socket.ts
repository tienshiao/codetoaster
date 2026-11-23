import type { WebSocketCompressor } from "bun";

/**
 * How the terminal socket compresses what it sends (TASK-147).
 *
 * Two settings, and both are needed. `perMessageDeflate` only *negotiates*
 * the extension: Bun answers a browser's offer and then sends every frame raw
 * unless that frame's `send` passes `compress: true`, which is why every send
 * goes through `sendFrame` below rather than calling `ws.send` itself.
 *
 * `"dedicated"` rather than `"shared"`, because a shared compressor resets its
 * window per message (`server_no_context_takeover`). Terminal output arrives
 * as many small `data` frames that repeat each other — prompts, colour codes,
 * the same JSON envelope — and only a window that survives between frames can
 * see that: fifty `ls` lines went 5680 → 4880 bytes shared and 5680 → 586
 * dedicated. The cost is a deflate state per socket, and the daemon has a
 * handful of browsers attached, not thousands.
 *
 * Decompression is on so a browser that compresses its own frames (Chrome does
 * once the extension is agreed) is understood; what clients send is keystrokes
 * and resizes, so a shared decompressor is plenty.
 *
 * Shared with the tests, which mount it on a server of their own: a test of a
 * copy would pass whatever `server.ts` said.
 */
export const terminalSocketCompression: {
  compress: WebSocketCompressor;
  decompress: WebSocketCompressor | boolean;
} = {
  compress: "dedicated",
  decompress: true,
};

/** Anything a frame can be sent on: the real socket, or a test's stand-in. */
export interface FrameSink {
  send(data: string, compress?: boolean): unknown;
}

/** Send one text frame, compressed when the client agreed to it.
 *
 * `true` is a request, not an order: on a socket that did not negotiate
 * permessage-deflate Bun sends the frame raw, so a client without the
 * extension still reads plain text. Asked for on every frame, small ones too,
 * because the dedicated window above is what makes a 100-byte `data` frame
 * shrink — it back-references the frames before it. */
export function sendFrame(ws: FrameSink, data: string): void {
  ws.send(data, true);
}
