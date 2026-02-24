import { useEffect, useRef, useState, useImperativeHandle, forwardRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon } from "@xterm/addon-search";
import { Upload } from "lucide-react";
import { useTerminalTheme } from "./hooks/use-terminal-theme";
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
  focus: () => void;
  getSearchAddon: () => SearchAddon | null;
}

interface XTerminalProps {
  onSizeChange: (size: TerminalSize) => void;
  onReady: () => void;
  sendMessage: (msg: object) => void;
  onFileDrop?: (files: File[]) => void;
  onSearchOpen?: () => void;
}

export const XTerminal = forwardRef<TerminalHandle, XTerminalProps>(
  function XTerminal({ onSizeChange, onReady, sendMessage, onFileDrop, onSearchOpen }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const termRef = useRef<Terminal | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const searchAddonRef = useRef<SearchAddon | null>(null);
    const attachedRef = useRef(false);
    const [isDragOver, setIsDragOver] = useState(false);
    const dragCounterRef = useRef(0);
    const { theme: terminalTheme, cssFontFamily, fontSize } = useTerminalTheme();
    const terminalThemeRef = useRef(terminalTheme);
    terminalThemeRef.current = terminalTheme;
    const cssFontFamilyRef = useRef(cssFontFamily);
    cssFontFamilyRef.current = cssFontFamily;
    const fontSizeRef = useRef(fontSize);
    fontSizeRef.current = fontSize;

    // Store callbacks in refs
    const onSizeChangeRef = useRef(onSizeChange);
    const sendMessageRef = useRef(sendMessage);
    const onFileDropRef = useRef(onFileDrop);
    const onSearchOpenRef = useRef(onSearchOpen);
    onSizeChangeRef.current = onSizeChange;
    sendMessageRef.current = sendMessage;
    onFileDropRef.current = onFileDrop;
    onSearchOpenRef.current = onSearchOpen;

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
            // Re-fit terminal to actual container size after restoring session content.
            // The restore resizes the grid to the session's stored size, which may not
            // match this client's container. Fitting ensures the grid fills the container,
            // and onSizeChange sends the actual size to the server for negotiation.
            if (fitAddonRef.current) {
              fitAddonRef.current.fit();
              onSizeChangeRef.current({ cols: term.cols, rows: term.rows });
            }
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
      focus: () => {
        termRef.current?.focus();
      },
      getSearchAddon: () => searchAddonRef.current,
    }), []);

    // Initialize terminal - runs once
    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      const term = new Terminal({
        cursorBlink: true,
        allowProposedApi: true,
        theme: terminalThemeRef.current,
        fontFamily: cssFontFamilyRef.current,
        ...(fontSizeRef.current ? { fontSize: fontSizeRef.current } : {}),
      });
      const fitAddon = new FitAddon();
      const webLinksAddon = new WebLinksAddon();
      const searchAddon = new SearchAddon();
      term.loadAddon(fitAddon);
      term.loadAddon(webLinksAddon);
      term.loadAddon(searchAddon);
      term.open(container);
      fitAddon.fit();

      termRef.current = term;
      fitAddonRef.current = fitAddon;
      searchAddonRef.current = searchAddon;

      // Handle terminal input
      const dataDisposable = term.onData((data) => {
        if (attachedRef.current) {
          sendMessageRef.current({ type: "input", data });
        }
      });

      // Handle shift-enter and Cmd/Ctrl+F for search
      term.attachCustomKeyEventHandler((ev: KeyboardEvent) => {
        if (ev.key === "Enter" && ev.shiftKey) {
          if (ev.type === "keydown" && attachedRef.current) {
            sendMessageRef.current({ type: "input", data: String.fromCharCode(10) });
          }
          return false;
        }
        if (ev.key === "f" && (ev.metaKey || ev.ctrlKey) && !ev.shiftKey && !ev.altKey) {
          if (ev.type === "keydown") {
            ev.preventDefault();
            onSearchOpenRef.current?.();
          }
          return false;
        }
        // Let Cmd+P propagate for command palette
        if (ev.key === "p" && (ev.metaKey || ev.ctrlKey) && !ev.shiftKey && !ev.altKey) {
          return false;
        }
        // Let Cmd+G / Shift+Cmd+G propagate for search next/prev
        if (ev.key === "g" && (ev.metaKey || ev.ctrlKey) && !ev.altKey) {
          return false;
        }
        return true;
      });

      // Handle resize (skip when container is hidden/zero-sized to avoid corruption)
      const resizeObserver = new ResizeObserver(() => {
        if (container.clientWidth === 0 || container.clientHeight === 0) return;
        fitAddon.fit();
        onSizeChangeRef.current({ cols: term.cols, rows: term.rows });
      });
      resizeObserver.observe(container);

      // Touch scrolling workaround (fixed in xterm.js 6.1.0, remove when upgraded)
      const screenEl = container.querySelector('.xterm-screen') as HTMLElement | null;
      let touchStartY = 0;
      let accumulatedDelta = 0;
      const lineHeight = term.options.lineHeight
        ? Math.ceil(term.options.lineHeight * (term.options.fontSize ?? 15))
        : (term.options.fontSize ?? 15);
      const handleTouchStart = (e: TouchEvent) => {
        const touch = e.touches[0];
        if (e.touches.length === 1 && touch) {
          touchStartY = touch.clientY;
          accumulatedDelta = 0;
        }
      };
      const handleTouchMove = (e: TouchEvent) => {
        if (e.touches.length !== 1) return;
        const touch = e.touches[0]!;
        e.preventDefault();
        const deltaY = touchStartY - touch.clientY;
        touchStartY = touch.clientY;
        accumulatedDelta += deltaY;
        const lines = Math.trunc(accumulatedDelta / lineHeight);
        if (lines !== 0) {
          term.scrollLines(lines);
          accumulatedDelta -= lines * lineHeight;
        }
      };
      screenEl?.addEventListener("touchstart", handleTouchStart, { passive: true });
      screenEl?.addEventListener("touchmove", handleTouchMove, { passive: false });

      // Handle paste with files (screenshots, copied files)
      const handlePaste = (e: ClipboardEvent) => {
        if (e.clipboardData && e.clipboardData.files.length > 0) {
          e.preventDefault();
          onFileDropRef.current?.(Array.from(e.clipboardData.files));
        }
      };
      container.addEventListener("paste", handlePaste, true);

      // Report ready
      onReady();

      return () => {
        dataDisposable.dispose();
        resizeObserver.disconnect();
        screenEl?.removeEventListener("touchstart", handleTouchStart);
        screenEl?.removeEventListener("touchmove", handleTouchMove);
        container.removeEventListener("paste", handlePaste, true);
        term.dispose();
        termRef.current = null;
        fitAddonRef.current = null;
        searchAddonRef.current = null;
      };
    }, [onReady]);

    // Apply terminal theme changes reactively
    useEffect(() => {
      if (termRef.current) {
        termRef.current.options.theme = terminalTheme ?? {};
      }
    }, [terminalTheme]);

    // Apply font changes reactively
    useEffect(() => {
      const term = termRef.current;
      const fitAddon = fitAddonRef.current;
      if (!term || !fitAddon) return;
      term.options.fontFamily = cssFontFamily;
      document.fonts.load(`16px ${cssFontFamily}`).then(() => {
        fitAddon.fit();
        onSizeChangeRef.current({ cols: term.cols, rows: term.rows });
      });
    }, [cssFontFamily]);

    // Apply font size changes reactively
    useEffect(() => {
      const term = termRef.current;
      const fitAddon = fitAddonRef.current;
      if (!term || !fitAddon) return;
      term.options.fontSize = fontSize || 15;
      fitAddon.fit();
      onSizeChangeRef.current({ cols: term.cols, rows: term.rows });
    }, [fontSize]);

    return (
      <div
        className="relative w-full h-full p-2"
        style={{ backgroundColor: terminalTheme?.background ?? '#000' }}
        onDragEnter={(e) => {
          e.preventDefault();
          dragCounterRef.current++;
          if (e.dataTransfer.types.includes("Files")) setIsDragOver(true);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={(e) => {
          e.preventDefault();
          dragCounterRef.current--;
          if (dragCounterRef.current === 0) setIsDragOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          dragCounterRef.current = 0;
          setIsDragOver(false);
          const files = Array.from(e.dataTransfer.files);
          if (files.length > 0) onFileDropRef.current?.(files);
        }}
      >
        <div ref={containerRef} className="w-full h-full" />
        {isDragOver && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/80 pointer-events-none">
            <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-zinc-500 bg-zinc-900/80 px-10 py-8">
              <Upload className="size-8 text-zinc-400" />
              <span className="text-sm text-zinc-300">Drop files to upload</span>
            </div>
          </div>
        )}
      </div>
    );
  }
);
