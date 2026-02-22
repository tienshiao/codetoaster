import { serve } from "bun";
import index from "./frontend/index.html";
import { sessionManager } from "./lib/xtmux/session-manager";
import type { ClientMessage, WebSocketData } from "./lib/xtmux/types";

const PORT = parseInt(process.env.PORT || "4000", 10);

let clientIdCounter = 0;

function generateClientId(): string {
  return `client-${++clientIdCounter}-${Date.now()}`;
}

function sendError(ws: { send: (data: string) => void }, message: string): void {
  ws.send(JSON.stringify({ type: "error", message }));
}

const server = serve<WebSocketData>({
  port: PORT,
  routes: {
    // Serve index.html for all unmatched routes.
    "/*": index,

    "/api/sessions": {
      GET() {
        return Response.json(sessionManager.listSessions());
      },
    },

    "/api/sessions/:id": {
      DELETE(req: Request & { params: { id: string } }) {
        const id = req.params.id;
        const killed = sessionManager.killSession(id);
        if (killed) {
          sessionManager.broadcastSessionList();
          return Response.json({ success: true });
        }
        return Response.json({ error: "Session not found" }, { status: 404 });
      },
    },

    "/api/sessions/:id/upload": {
      async POST(req: Request & { params: { id: string } }) {
        const session = sessionManager.getSession(req.params.id);
        if (!session) {
          return Response.json({ error: "Session not found" }, { status: 404 });
        }
        const formData = await req.formData();
        const files = formData.getAll("files") as File[];
        if (files.length === 0) {
          return Response.json({ error: "No files" }, { status: 400 });
        }
        const paths: string[] = [];
        for (const file of files) {
          const tmpPath = `/tmp/${crypto.randomUUID()}-${file.name}`;
          await Bun.write(tmpPath, file);
          paths.push(tmpPath);
        }
        session.write(paths.join(" "));
        return Response.json({ paths });
      },
    },
  },

  websocket: {
    open(ws) {
      sessionManager.registerClient(ws.data.clientId, ws);
    },

    message(ws, message) {
      if (typeof message !== "string") {
        sendError(ws, "Binary messages not supported");
        return;
      }

      let parsed: ClientMessage;
      try {
        parsed = JSON.parse(message);
      } catch {
        sendError(ws, "Invalid JSON");
        return;
      }

      const { clientId } = ws.data;

      switch (parsed.type) {
        case "create": {
          const { sessionId, name, cols, rows } = parsed;
          try {
            const session = sessionManager.createSession(sessionId, name || sessionId, cols, rows);
            sessionManager.attachClient(sessionId, clientId, ws, cols, rows);
            ws.data.sessionId = sessionId;
            sessionManager.broadcastSessionList();
          } catch (e: any) {
            sendError(ws, e.message);
          }
          break;
        }

        case "attach": {
          const { sessionId, cols, rows } = parsed;
          const session = sessionManager.attachClient(sessionId, clientId, ws, cols, rows);
          if (session) {
            ws.data.sessionId = sessionId;
          } else {
            sendError(ws, `Session "${sessionId}" not found`);
          }
          break;
        }

        case "detach": {
          sessionManager.detachClient(clientId);
          ws.data.sessionId = null;
          break;
        }

        case "input": {
          const session = sessionManager.getClientSession(clientId);
          if (session) {
            session.write(parsed.data);
          } else {
            sendError(ws, "Not attached to a session");
          }
          break;
        }

        case "resize": {
          const session = sessionManager.getClientSession(clientId);
          if (session) {
            session.updateClientSize(clientId, parsed.cols, parsed.rows);
          }
          break;
        }

        case "list": {
          ws.send(
            JSON.stringify({
              type: "sessions",
              list: sessionManager.listSessions(),
            })
          );
          break;
        }

        case "kill": {
          const killed = sessionManager.killSession(parsed.sessionId);
          if (killed) {
            sessionManager.broadcastSessionList();
          } else {
            sendError(ws, `Session "${parsed.sessionId}" not found`);
          }
          break;
        }

        case "rename": {
          const renamed = sessionManager.renameSession(parsed.sessionId, parsed.name);
          if (!renamed) {
            sendError(ws, `Session "${parsed.sessionId}" not found`);
          }
          break;
        }

        case "acknowledge": {
          sessionManager.acknowledgeSession(parsed.sessionId);
          break;
        }

        case "reorder": {
          sessionManager.reorderSessions(parsed.sessionIds);
          break;
        }

        default:
          sendError(ws, `Unknown message type`);
      }
    },

    close(ws) {
      sessionManager.detachClient(ws.data.clientId);
      sessionManager.unregisterClient(ws.data.clientId);
    },
  },

  fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname === "/terminal") {
      const upgraded = server.upgrade(req, {
        data: {
          clientId: generateClientId(),
          sessionId: null,
        },
      });
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

console.log(`Server running at ${server.url}`);
