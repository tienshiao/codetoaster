import { serve } from "bun";
import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, basename } from "node:path";
import index from "./frontend/index.html";
import { taskManager } from "./lib/tasks/manager";
import type { ClientMessage, WebSocketData } from "./lib/xtmux/types";
import { removePidFile } from "./cli/daemon";
import { taskRoutes } from "./api/tasks";
import { hookRoutes } from "./api/hooks";
import { diffRoutes } from "./api/diff";
import { fileRoutes } from "./api/files";
import { gitRoutes } from "./api/git";
import { highlightRoutes } from "./api/highlight";
import { symbolRoutes } from "./api/symbols";
import { initDatabase } from "./lib/db";
import {
  configureOriginGuard,
  crossOriginRefusal,
  guardApiRoutes,
  guardRoute,
  isSameOriginRequest,
} from "./api/origin";

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

/** Where a daemon bound to `hostname` can actually be reached.
 *
 * A wildcard is an instruction to listen everywhere, not an address to connect
 * to, so it resolves to loopback. A concrete bind is reachable at exactly the
 * name the user gave and *only* there — which is the whole reason this exists:
 * `--host 192.168.1.20` makes `http://localhost:<port>` refuse the connection,
 * and anything that assumed loopback (the CLI, the hook reporter) would call a
 * healthy daemon dead. */
export function reachableOrigin(hostname: string | undefined, port: number): string {
  const wildcard = !hostname || hostname === "0.0.0.0" || hostname === "::";
  const host = wildcard ? "localhost" : hostname;
  const bracketed = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return `http://${bracketed}:${port}`;
}

export interface ServerOptions {
  port?: number;
  dbPath?: string;
  /** What to bind. Loopback by default: the daemon spawns agents in the user's
   * repositories with no authentication in front of it, so being reachable
   * from the network is something to opt into, not out of. */
  hostname?: string;
  /** Host names the UI may be reached by, beyond the ones that cannot be
   * repointed. Needed when the bind is a wildcard and the user browses to a
   * name: `--host 0.0.0.0` says "be reachable", not which name to expect. */
  allowedHosts?: string[];
}

export function startServer(options?: ServerOptions) {
  const PORT = options?.port ?? parseInt(process.env.PORT || "4000", 10);
  const HOSTNAME = options?.hostname ?? "127.0.0.1";

  // Initialize database
  const dbPath = options?.dbPath ?? `${process.env.HOME ?? "."}/.codetoaster/data.db`;
  initDatabase(dbPath);
  taskManager.loadProjects();
  // Every `live` row is a lie at boot: the PTYs died with the previous daemon
  // (§5.5). Suspending them is the whole of what a restart needs.
  const suspended = taskManager.reconcileOnBoot();
  if (suspended > 0) {
    console.log(`Suspended ${suspended} task${suspended === 1 ? "" : "s"} left live by the previous run`);
  }

  // Read lazily, not computed here: `--port 0` means the real port does not
  // exist until `serve()` has returned.
  const selfOrigin = (): string => reachableOrigin(HOSTNAME, server.port ?? PORT);

  const server = serve<WebSocketData>({
    port: PORT,
    hostname: HOSTNAME,
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
          // The Host header is not a place to look up our own address. Bun
          // builds `req.url` from it, so `new URL(spaPath, url.origin)` sent
          // the daemon to fetch whatever host the caller named and then served
          // that body as its own HTML: `curl -H "Host: attacker.example" /`
          // returned the attacker's page from this origin, which is both a
          // request the daemon made on someone else's behalf and a way to run
          // their script inside our origin. Addressed to the listener instead,
          // which is the one thing we actually know.
          const response = await fetch(new URL(spaPath, selfOrigin()));
          const headers = new Headers(response.headers);
          headers.set("Cache-Control", "no-cache");
          return new Response(response.body, {
            status: response.status,
            headers,
          });
        },
      },

      "/api/tasks/:id/preview": guardRoute({
        GET(req: Request & { params: { id: string } }) {
          const session = taskManager.primaryPty(req.params.id);
          if (!session) {
            return new Response("Task has no live terminal", { status: 404 });
          }
          const url = new URL(req.url);
          const themeParam = url.searchParams.get("theme");
          let theme: Record<string, string> | undefined;
          try { theme = themeParam ? JSON.parse(themeParam) : undefined; } catch {};
          return new Response(session.getPreviewHTML(theme), {
            headers: { "Content-Type": "text/html; charset=utf-8" },
          });
        },
      }),

      "/api/tasks/:id/upload": guardRoute({
        async POST(req: Request & { params: { id: string } }) {
          const session = taskManager.primaryPty(req.params.id);
          if (!session) {
            return Response.json({ error: "Task has no live terminal" }, { status: 404 });
          }
          const formData = await req.formData();
          const files = formData.getAll("files") as File[];
          if (files.length === 0) {
            return Response.json({ error: "No files" }, { status: 400 });
          }
          const paths: string[] = [];
          for (const file of files) {
            // basename, because the name comes off a multipart body: a client
            // is free to send "../../.zshrc", and Bun.write would resolve it
            // out of /tmp and overwrite the file it names.
            const tmpPath = `/tmp/${crypto.randomUUID()}-${basename(file.name)}`;
            await Bun.write(tmpPath, file);
            paths.push(tmpPath);
          }
          session.write(paths.join(" "));
          return Response.json({ paths });
        },
      }),

      "/api/directories": guardRoute({
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

            return Response.json({ parent, directories, home });
          } catch {
            return Response.json({ parent: "", directories: [], home: "" });
          }
        },
      }),

      // Guarded as one table, so a route added to any of them is guarded by
      // construction rather than by someone remembering (TASK-42).
      ...guardApiRoutes({
        ...taskRoutes,
        ...hookRoutes,
        ...diffRoutes,
        ...fileRoutes,
        ...gitRoutes,
        ...highlightRoutes,
        ...symbolRoutes,
      }),

      "/api/ping": guardRoute({
        GET() {
          const version = typeof __VERSION__ !== "undefined" ? __VERSION__ : "dev";
          const gitHash = typeof __GIT_HASH__ !== "undefined" ? __GIT_HASH__ : "";
          return Response.json({
            status: "ok",
            version: version + (gitHash ? ` (${gitHash})` : ""),
            pid: process.pid,
            uptime: Math.floor((Date.now() - startTime) / 1000),
            sessions: taskManager.listTasks().length,
          });
        },
      }),

      "/api/connections": guardRoute({
        GET() {
          return Response.json(taskManager.getConnections());
        },
      }),

      "/api/shutdown": guardRoute({
        POST() {
          setTimeout(() => {
            removePidFile(PORT);
            process.exit(0);
          }, 100);
          return Response.json({ status: "shutting down" });
        },
      }),
    },

    websocket: {
      open(ws) {
        taskManager.registerClient(ws.data.clientId, ws);
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
          case "attach": {
            const { ptyId, cols, rows } = parsed;
            const pty = taskManager.attachClient(ptyId, clientId, ws, cols, rows);
            if (!pty) {
              sendError(ws, `Terminal "${ptyId}" not found`);
            }
            break;
          }

          case "detach": {
            // No ptyId detaches everything: what a client sends when it is
            // going away rather than closing one tab.
            taskManager.detachClient(clientId, parsed.ptyId);
            break;
          }

          case "input": {
            if (!taskManager.writeToPty(clientId, parsed.ptyId, parsed.data)) {
              sendError(ws, `Not attached to terminal "${parsed.ptyId}"`);
            }
            break;
          }

          case "resize": {
            taskManager.resizePty(clientId, parsed.ptyId, parsed.cols, parsed.rows);
            break;
          }

          case "list": {
            ws.send(JSON.stringify(taskManager.tasksSnapshot()));
            break;
          }

          case "kill": {
            if (taskManager.closeTask(parsed.taskId)) {
              taskManager.broadcastTasks();
            } else {
              sendError(ws, `Task "${parsed.taskId}" not found`);
            }
            break;
          }

          case "acknowledge": {
            taskManager.acknowledgeTask(parsed.taskId);
            break;
          }

          case "reorder": {
            taskManager.reorderProjects(parsed.projects);
            break;
          }

          case "createProject": {
            try {
              taskManager.createProject(parsed.id, parsed.name, parsed.initialPath);
            } catch (e: any) {
              sendError(ws, e.message);
            }
            break;
          }

          case "updateProject": {
            const updated = taskManager.updateProject(parsed.id, parsed.name, parsed.initialPath);
            if (!updated) {
              sendError(ws, `Project "${parsed.id}" not found`);
            }
            break;
          }

          case "deleteProject": {
            const deleted = taskManager.deleteProject(parsed.id);
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
        taskManager.detachClient(ws.data.clientId);
        taskManager.unregisterClient(ws.data.clientId);
      },
    },

    fetch(req, server) {
      const url = new URL(req.url);
      if (url.pathname === "/terminal") {
        // The same check the API gets. Without it the socket is a way round
        // the guard rather than a thing behind it: it takes `attach` and
        // `input` for any terminal, and `kill` for any task.
        if (!isSameOriginRequest(req)) return crossOriginRefusal();
        const upgraded = server.upgrade(req, {
          data: { clientId: generateClientId() },
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

  // Taken from the listener rather than from the requested port, and set the
  // moment it exists: `--port 0` asks the OS to pick one, and an agent told to
  // report to port 0 has nowhere to send its hooks (§4.2). Still before any
  // task can be created — nothing can reach the create route until serve()
  // has returned.
  taskManager.setPort(server.port ?? PORT, selfOrigin());
  // The guard needs to know what we actually answer to before it can tell a
  // Host header naming this daemon from one naming somewhere an attacker
  // controls. Same reason as the line above for doing it here: `--port 0`
  // means the port is not knowable until now.
  configureOriginGuard({
    port: server.port ?? PORT,
    hostname: HOSTNAME,
    allowedHosts: options?.allowedHosts,
  });

  return server;
}
