import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

export function XTerminal() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const term = new Terminal({ cursorBlink: true });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current!);
    fitAddon.fit();

    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${location.host}/terminal`);
    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
    };

    ws.onmessage = (e) => {
      term.write(new Uint8Array(e.data));
    };

    term.onData((data) => ws.send(data));

    // Map shift-enter to ctrl-j for Claude Code compatibility
    term.attachCustomKeyEventHandler((ev: KeyboardEvent) => {
      if (ev.key === 'Enter' && ev.shiftKey) {
        if (ev.type === 'keydown') {
          ws.send(String.fromCharCode(10)); // Send ctrl-j (newline)
        }
        return false; // Block both keydown and keypress to prevent double newline
      }
      return true; // Allow normal processing for other keys
    });

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      }
    });
    resizeObserver.observe(containerRef.current!);

    return () => {
      ws.close();
      term.dispose();
      resizeObserver.disconnect();
    };
  }, []);

  return <div ref={containerRef} className="terminal-container" />;
}
