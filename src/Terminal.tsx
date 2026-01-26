import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

interface XTerminalProps {
  sessionId?: string;
}

type ServerMessage =
  | { type: "attached"; sessionId: string }
  | { type: "restore"; data: string; size: { cols: number; rows: number }; cursor: { x: number; y: number } }
  | { type: "data"; data: string }
  | { type: "resize"; cols: number; rows: number }
  | { type: "exit"; code: number }
  | { type: "error"; message: string }
  | { type: "sessions"; list: unknown[] };

export function XTerminal({ sessionId = "default" }: XTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const term = new Terminal({ cursorBlink: true });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current!);
    fitAddon.fit();

    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${location.host}/terminal`);

    let attached = false;
    let pendingResize: { cols: number; rows: number } | null = null;

    const send = (msg: object) => ws.send(JSON.stringify(msg));

    ws.onopen = () => {
      // Try to attach to existing session first, if that fails we'll create
      send({
        type: "attach",
        sessionId,
        cols: term.cols,
        rows: term.rows,
      });
    };

    ws.onmessage = (e) => {
      let message: ServerMessage;
      try {
        message = JSON.parse(e.data);
      } catch {
        return;
      }

      switch (message.type) {
        case "attached":
          attached = true;
          // Send any pending resize that occurred before attachment
          if (pendingResize) {
            send({ type: "resize", cols: pendingResize.cols, rows: pendingResize.rows });
            pendingResize = null;
          }
          break;

        case "restore":
          // Apply server-dictated size (serialized content is formatted for this size)
          term.resize(message.size.cols, message.size.rows);
          // Write serialized content
          if (message.data) {
            term.write(message.data);
          }
          // CRITICAL: Explicitly position cursor using absolute coordinates
          // The serialize content may include relative cursor movements from
          // shell prompts (like fish) that don't work correctly when replayed
          // CSI row;col H is 1-indexed
          term.write(`\x1b[${message.cursor.y + 1};${message.cursor.x + 1}H`);
          break;

        case "data":
          term.write(message.data);
          break;

        case "resize":
          // Server dictates terminal size (smallest-wins among all clients)
          term.resize(message.cols, message.rows);
          break;

        case "exit":
          term.write(`\r\n[Process exited with code ${message.code}]\r\n`);
          attached = false;
          break;

        case "error":
          // If attach failed, try to create the session
          if (message.message.includes("not found")) {
            send({
              type: "create",
              sessionId,
              cols: term.cols,
              rows: term.rows,
            });
          } else {
            term.write(`\r\n[Error: ${message.message}]\r\n`);
          }
          break;
      }
    };

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN && attached) {
        send({ type: "input", data });
      }
    });

    // Map shift-enter to ctrl-j for Claude Code compatibility
    term.attachCustomKeyEventHandler((ev: KeyboardEvent) => {
      if (ev.key === "Enter" && ev.shiftKey) {
        if (ev.type === "keydown" && ws.readyState === WebSocket.OPEN && attached) {
          send({ type: "input", data: String.fromCharCode(10) });
        }
        return false;
      }
      return true;
    });

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      if (ws.readyState === WebSocket.OPEN) {
        if (attached) {
          send({ type: "resize", cols: term.cols, rows: term.rows });
        } else {
          // Store pending resize to send after attachment
          pendingResize = { cols: term.cols, rows: term.rows };
        }
      }
    });
    resizeObserver.observe(containerRef.current!);

    return () => {
      ws.close();
      term.dispose();
      resizeObserver.disconnect();
    };
  }, [sessionId]);

  return <div ref={containerRef} className="terminal-container" />;
}
