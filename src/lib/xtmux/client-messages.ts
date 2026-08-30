import type { ServerWebSocket } from "bun";
import type { TaskManager } from "../tasks/manager";
import type { ClientMessage, WebSocketData } from "./types";

/**
 * What the server does with a frame from a client.
 *
 * Lifted out of `server.ts` because it is the half of the socket worth testing
 * on its own: `server.ts` imports the frontend's HTML entry point, so importing
 * it from a test bundles the whole app, and the manager it drives is a
 * singleton there while every test builds its own.
 */

/** Refuse a request.
 *
 * `ptyId` is the terminal that provoked it, and it is what lets a client
 * showing several of them place the answer (§7.4). Omit it only for failures
 * that are genuinely client-wide: a client cannot show "invalid JSON" in a
 * particular grid because no particular grid asked for it.
 */
export function sendError(
  ws: { send: (data: string) => void },
  message: string,
  ptyId?: string,
): void {
  ws.send(JSON.stringify({ type: "error", message, ...(ptyId ? { ptyId } : {}) }));
}

export function handleClientMessage(
  manager: TaskManager,
  ws: ServerWebSocket<WebSocketData>,
  message: string | Buffer,
): void {
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
      const pty = manager.attachClient(ptyId, clientId, ws, cols, rows);
      if (!pty) {
        // Addressed, because this is the answer to a stale attach — the ptyId
        // a client remembered across a daemon restart — and the grid that
        // asked for it is sitting there with nothing else to show for it.
        sendError(ws, `Terminal "${ptyId}" not found`, ptyId);
      }
      break;
    }

    case "detach": {
      // No ptyId detaches everything: what a client sends when it is
      // going away rather than closing one tab.
      manager.detachClient(clientId, parsed.ptyId);
      break;
    }

    case "input": {
      if (!manager.writeToPty(clientId, parsed.ptyId, parsed.data)) {
        sendError(ws, `Not attached to terminal "${parsed.ptyId}"`, parsed.ptyId);
      }
      break;
    }

    case "resize": {
      manager.resizePty(clientId, parsed.ptyId, parsed.cols, parsed.rows);
      break;
    }

    case "list": {
      ws.send(JSON.stringify(manager.tasksSnapshot()));
      break;
    }

    case "kill": {
      // v1's name for a v2 suspend (§6). Renaming a wire message is a
      // protocol change this is not, but what it does has moved: the
      // destructive path is `DELETE /api/tasks/:id` and nothing a client
      // sends can reach it, so a stale tab from before this change
      // suspends a task rather than deleting one.
      //
      // Fired rather than awaited, because the message handler is
      // synchronous and nothing later in it depends on the outcome.
      // `suspendTask` broadcasts the row it changed, so the only thing
      // left to say is that there was no such task — asked of the store
      // rather than read off the answer, which is also false for a task
      // that was already suspended and is therefore already closed.
      const { taskId } = parsed;
      if (!manager.getTask(taskId)) {
        // A task, not a terminal: the client named no ptyId and the task may
        // have several. Client-wide is the honest address for it.
        sendError(ws, `Task "${taskId}" not found`);
        break;
      }
      void manager.closeTask(taskId).catch((e) => {
        console.warn(`Could not close task ${taskId}:`, e);
      });
      break;
    }

    case "acknowledge": {
      manager.acknowledgeTask(parsed.taskId);
      break;
    }

    case "reorder": {
      manager.reorderProjects(parsed.projects);
      break;
    }

    case "createProject": {
      try {
        manager.createProject(parsed.id, parsed.name, parsed.initialPath);
      } catch (e: any) {
        sendError(ws, e.message);
      }
      break;
    }

    case "updateProject": {
      const updated = manager.updateProject(parsed.id, parsed.name, parsed.initialPath);
      if (!updated) {
        sendError(ws, `Project "${parsed.id}" not found`);
      }
      break;
    }

    case "deleteProject": {
      const deleted = manager.deleteProject(parsed.id);
      if (!deleted) {
        sendError(ws, `Cannot delete project "${parsed.id}"`);
      }
      break;
    }

    default:
      sendError(ws, `Unknown message type`);
  }
}
