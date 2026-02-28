import { serve } from "bun";
import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, basename } from "node:path";
import index from "./frontend/index.html";
import { sessionManager } from "./lib/xtmux/session-manager";
import type { ClientMessage, WebSocketData } from "./lib/xtmux/types";
import { removePidFile } from "./cli/daemon";
import { diffRoutes } from "./api/diff";
import { initDatabase } from "./lib/db";

let clientIdCounter = 0;
const startTime = Date.now();
const spaPath = `/${crypto.randomUUID()}`;

// Asset extensions that should never be served as HTML.
// If a browser requests one of these and it doesn't match a real static file,
// it's a stale cached reference — return 404 instead of the SPA.
const assetExtRe = /\.(js|css|mjs|woff2?|ttf|otf|eot|map|png|jpe?g|gif|svg|ico|webp|avif)$/;

function generateClientId(): string {
  return `client-${++clientIdCounter}-${Date.now()}`;
}

function sendError(ws: { send: (data: string) => void }, message: string): void {
  ws.send(JSON.stringify({ type: "error", message }));
}

export interface ServerOptions {
  port?: number;
  dbPath?: string;
}

export function startServer(options?: ServerOptions) {
  const PORT = options?.port ?? parseInt(process.env.PORT || "4000", 10);

  // Initialize database
  const dbPath = options?.dbPath ?? `${process.env.HOME ?? "."}/.codetoaster/data.db`;
  initDatabase(dbPath);
  sessionManager.loadProjects();

  const server = serve<WebSocketData>({
    port: PORT,
    routes: {
      // Mount the SPA on a hidden UUID path so Bun handles bundling/hashing.
      // The wildcard route below proxies to it with proper cache headers.
      [spaPath]: index,

      "/*": {
        async GET(req: Request) {
          const url = new URL(req.url);
          // Stale asset request from an old cached index.html — return 404
          if (assetExtRe.test(url.pathname)) {
            return new Response("Not found", { status: 404 });
          }
          // Proxy to the internal SPA path and set no-cache on the HTML
          const spaUrl = new URL(spaPath, url.origin);
          const response = await fetch(spaUrl);
          const headers = new Headers(response.headers);
          headers.set("Cache-Control", "no-cache");
          return new Response(response.body, {
            status: response.status,
            headers,
          });
        },
      },

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

      "/api/sessions/:id/preview": {
        GET(req: Request & { params: { id: string } }) {
          const session = sessionManager.getSession(req.params.id);
          if (!session) {
            return new Response("Session not found", { status: 404 });
          }
          const url = new URL(req.url);
          const themeParam = url.searchParams.get("theme");
          let theme: Record<string, string> | undefined;
          try { theme = themeParam ? JSON.parse(themeParam) : undefined; } catch {};
          return new Response(session.getPreviewHTML(theme), {
            headers: { "Content-Type": "text/html; charset=utf-8" },
          });
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

      "/api/directories": {
        async GET(req: Request) {
          try {
            const url = new URL(req.url);
            const home = homedir();
            let rawPath = url.searchParams.get("path") ?? "";

            // Expand tilde
            if (rawPath.startsWith("~")) {
              rawPath = home + rawPath.slice(1);
            }

            // Default to home directory
            if (!rawPath) rawPath = home;

            let dirToList: string;
            let prefix = "";

            if (rawPath.endsWith("/")) {
              dirToList = rawPath;
            } else {
              dirToList = dirname(rawPath);
              prefix = basename(rawPath).toLowerCase();
            }

            const entries = await readdir(dirToList, { withFileTypes: true });
            let directories = entries
              .filter((e) => e.isDirectory() && !e.name.startsWith("."))
              .map((e) => e.name);

            if (prefix) {
              directories = directories.filter((n) =>
                n.toLowerCase().startsWith(prefix)
              );
            }

            directories.sort((a, b) => a.localeCompare(b));
            directories = directories.slice(0, 50);

            // Replace homedir with ~ for display
            let parent = dirToList.endsWith("/") ? dirToList.slice(0, -1) : dirToList;
            if (parent === home) {
              parent = "~";
            } else if (parent.startsWith(home + "/")) {
              parent = "~" + parent.slice(home.length);
            }

            return Response.json({ parent, directories });
          } catch {
            return Response.json({ parent: "", directories: [] });
          }
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
            removePidFile(PORT);
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
            const { sessionId, name, cols, rows, projectId, afterSessionId } = parsed;
            sessionManager.createSession(sessionId, name || sessionId, cols, rows, projectId, afterSessionId).then(
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
                projects: sessionManager.getProjects(),
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
            sessionManager.reorderProjects(parsed.projects);
            break;
          }

          case "createProject": {
            try {
              sessionManager.createProject(parsed.id, parsed.name, parsed.initialPath, parsed.color);
            } catch (e: any) {
              sendError(ws, e.message);
            }
            break;
          }

          case "updateProject": {
            const updated = sessionManager.updateProject(parsed.id, parsed.name, parsed.initialPath, parsed.color);
            if (!updated) {
              sendError(ws, `Project "${parsed.id}" not found`);
            }
            break;
          }

          case "deleteProject": {
            const deleted = sessionManager.deleteProject(parsed.id);
            if (!deleted) {
              sendError(ws, `Cannot delete project "${parsed.id}"`);
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
