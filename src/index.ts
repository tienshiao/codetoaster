import { serve, type Subprocess } from "bun";
import index from "./index.html";

interface TerminalWebSocketData {
  proc: Subprocess;
}

const server = serve<TerminalWebSocketData>({
  routes: {
    // Serve index.html for all unmatched routes.
    "/*": index,

    "/api/hello": {
      async GET(req) {
        return Response.json({
          message: "Hello, world!",
          method: "GET",
        });
      },
      async PUT(req) {
        return Response.json({
          message: "Hello, world!",
          method: "PUT",
        });
      },
    },

    "/api/hello/:name": async req => {
      const name = req.params.name;
      return Response.json({
        message: `Hello, ${name}!`,
      });
    },
  },

  websocket: {
    open(ws) {
      const proc = Bun.spawn([process.env.SHELL || "bash"], {
        terminal: {
          cols: 80,
          rows: 24,
          data(terminal, data) {
            ws.send(data);
          },
        },
      });
      ws.data = { proc };
    },
    message(ws, message) {
      if (typeof message === "string" && message.startsWith("{")) {
        try {
          const parsed = JSON.parse(message);
          if (parsed.type === "resize") {
            ws.data.proc.terminal?.resize(parsed.cols, parsed.rows);
          }
        } catch {
          // Not valid JSON, treat as regular input
          ws.data.proc.terminal?.write(message);
        }
      } else {
        ws.data.proc.terminal?.write(message);
      }
    },
    close(ws) {
      ws.data.proc.terminal?.close();
      ws.data.proc.kill();
    },
  },

  fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname === "/terminal") {
      const upgraded = server.upgrade(req);
      if (upgraded) return;
      return new Response("WebSocket upgrade failed", { status: 400 });
    }
    return new Response("Not found", { status: 404 });
  },

  development: process.env.NODE_ENV !== "production" && {
    // Enable browser hot reloading in development
    hmr: true,

    // Echo console logs from the browser to the server
    console: true,
  },
});

console.log(`🚀 Server running at ${server.url}`);
