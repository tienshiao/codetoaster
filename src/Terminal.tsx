import { useEffect, useRef, useImperativeHandle, forwardRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

export interface TerminalSize {
  cols: number;
  rows: number;
}

export interface TerminalHandle {
  handleMessage: (message: any) => void;
  send: (msg: object) => void;
  getSize: () => TerminalSize;
  resetAttached: () => void;
}

interface XTerminalProps {
  onSizeChange: (size: TerminalSize) => void;
  onReady: () => void;
  sendMessage: (msg: object) => void;
}

export const XTerminal = forwardRef<TerminalHandle, XTerminalProps>(
  function XTerminal({ onSizeChange, onReady, sendMessage }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const termRef = useRef<Terminal | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const attachedRef = useRef(false);

    // Store callbacks in refs
    const onSizeChangeRef = useRef(onSizeChange);
    const sendMessageRef = useRef(sendMessage);
    onSizeChangeRef.current = onSizeChange;
    sendMessageRef.current = sendMessage;

    // Expose methods to parent
    useImperativeHandle(ref, () => ({
      handleMessage: (message: any) => {
        const term = termRef.current;
        if (!term) return;

        switch (message.type) {
          case "attached":
            attachedRef.current = true;
            term.focus();
            break;

          case "restore":
            term.clear();
            term.reset();
            term.resize(message.size.cols, message.size.rows);
            if (message.data) {
              term.write(message.data);
            }
            term.write(`\x1b[${message.cursor.y + 1};${message.cursor.x + 1}H`);
            break;

          case "data":
            term.write(message.data);
            break;

          case "resize":
            term.resize(message.cols, message.rows);
            break;

          case "exit":
            term.write(`\r\n[Process exited with code ${message.code}]\r\n`);
            attachedRef.current = false;
            break;

          case "error":
            term.write(`\r\n[Error: ${message.message}]\r\n`);
            break;
        }
      },
      send: (msg: object) => {
        if (attachedRef.current) {
          sendMessageRef.current(msg);
        }
      },
      getSize: () => {
        const term = termRef.current;
        return term ? { cols: term.cols, rows: term.rows } : { cols: 80, rows: 24 };
      },
      resetAttached: () => {
        attachedRef.current = false;
      },
    }), []);

    // Initialize terminal - runs once
    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      const term = new Terminal({ cursorBlink: true });
      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(container);
      fitAddon.fit();

      termRef.current = term;
      fitAddonRef.current = fitAddon;

      // Handle terminal input
      const dataDisposable = term.onData((data) => {
        if (attachedRef.current) {
          sendMessageRef.current({ type: "input", data });
        }
      });

      // Handle shift-enter
      term.attachCustomKeyEventHandler((ev: KeyboardEvent) => {
        if (ev.key === "Enter" && ev.shiftKey) {
          if (ev.type === "keydown" && attachedRef.current) {
            sendMessageRef.current({ type: "input", data: String.fromCharCode(10) });
          }
          return false;
        }
        return true;
      });

      // Handle resize
      const resizeObserver = new ResizeObserver(() => {
        fitAddon.fit();
        onSizeChangeRef.current({ cols: term.cols, rows: term.rows });
      });
      resizeObserver.observe(container);

      // Report ready
      onReady();

      return () => {
        dataDisposable.dispose();
        resizeObserver.disconnect();
        term.dispose();
        termRef.current = null;
        fitAddonRef.current = null;
      };
    }, [onReady]);

    return <div ref={containerRef} className="terminal-container" />;
  }
);
