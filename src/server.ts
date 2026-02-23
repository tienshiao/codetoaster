import { serve } from "bun";
import index from "./frontend/index.html";
import { sessionManager } from "./lib/xtmux/session-manager";
import type { ClientMessage, WebSocketData } from "./lib/xtmux/types";
import { removePidFile } from "./cli/daemon";
import { diffRoutes } from "./api/diff";

let clientIdCounter = 0;
const startTime = Date.now();

function generateClientId(): string {
  return `client-${++clientIdCounter}-${Date.now()}`;
}

function sendError(ws: { send: (data: string) => void }, message: string): void {
  ws.send(JSON.stringify({ type: "error", message }));
}

export interface ServerOptions {
  port?: number;
}

export function startServer(options?: ServerOptions) {
  const PORT = options?.port ?? parseInt(process.env.PORT || "4000", 10);

  const server = serve<WebSocketData>({
    port: PORT,
    routes: {
      "/*": index,

      "/api/sessions": {
        async GET() {
          const sessions = sessionManager.listSessions();
          const withCwd = await Promise.all(
            sessions.map(async (s) => {
              const session = sessionManager.getSession(s.id);
              const cwd = session ? await session.getCwd() : undefined;
              return { ...s, cwd: cwd ?? null };
            })
          );
          return Response.json(withCwd);
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

      ...diffRoutes,

      "/api/ping": {
        GET() {
          const version = typeof __VERSION__ !== "undefined" ? __VERSION__ : "dev";
          const gitHash = typeof __GIT_HASH__ !== "undefined" ? __GIT_HASH__ : "";
          return Response.json({
            status: "ok",
            version: version + (gitHash ? ` (${gitHash})` : ""),
            pid: process.pid,
            uptime: Math.floor((Date.now() - startTime) / 1000),
            sessions: sessionManager.listSessions().length,
          });
        },
      },

      "/api/connections": {
        GET() {
          return Response.json(sessionManager.getConnections());
        },
      },

      "/api/shutdown": {
        POST() {
          setTimeout(() => {
            removePidFile();
            process.exit(0);
          }, 100);
          return Response.json({ status: "shutting down" });
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
            const { sessionId, name, cols, rows, folderId, afterSessionId } = parsed;
            sessionManager.createSession(sessionId, name || sessionId, cols, rows, folderId, afterSessionId).then(
              (session) => {
                sessionManager.attachClient(sessionId, clientId, ws, cols, rows);
                ws.data.sessionId = sessionId;
                sessionManager.broadcastSessionList();
              },
              (e: any) => {
                sendError(ws, e.message);
              }
            );
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
                folders: sessionManager.getFolders(),
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
            sessionManager.reorderFolders(parsed.folders);
            break;
          }

          case "createFolder": {
            try {
              sessionManager.createFolder(parsed.id, parsed.name);
            } catch (e: any) {
              sendError(ws, e.message);
            }
            break;
          }

          case "renameFolder": {
            const renamed = sessionManager.renameFolder(parsed.id, parsed.name);
            if (!renamed) {
              sendError(ws, `Folder "${parsed.id}" not found`);
            }
            break;
          }

          case "deleteFolder": {
            const deleted = sessionManager.deleteFolder(parsed.id);
            if (!deleted) {
              sendError(ws, `Cannot delete folder "${parsed.id}"`);
            }
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
      hmr: true,
      console: true,
    },
  });

  return server;
}
