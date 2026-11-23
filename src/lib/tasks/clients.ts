import type { ServerWebSocket } from "bun";
import * as os from "os";
import { sendFrame } from "../xtmux/socket";
import type { ServerMessage, WebSocketData } from "../xtmux/types";
import type { TaskHost } from "./host";

/** The browsers connected to this daemon, and the broadcasts that reach them:
 * the whole task list, one task, or any other frame. Split out of TaskManager
 * (TASK-152). */
export class ClientRegistry {
  connectedClients: Map<string, ServerWebSocket<WebSocketData>> = new Map();

  constructor(private readonly host: TaskHost) {}

  registerClient(clientId: string, ws: ServerWebSocket<WebSocketData>): void {
    this.connectedClients.set(clientId, ws);
    this.host.reconcileWatchers();
  }

  unregisterClient(clientId: string): void {
    this.connectedClients.delete(clientId);
    this.host.reconcileWatchers();
  }

  broadcastToAll(message: object): void {
    const data = JSON.stringify(message);
    for (const ws of this.connectedClients.values()) {
      sendFrame(ws, data);
    }
  }

  /** The whole list, as one message. Shared with the `list` request so a
   * client that asks for the snapshot and one that is pushed it cannot drift. */
  tasksSnapshot(): ServerMessage {
    return {
      type: "tasks",
      list: this.host.listTasks(),
      projects: this.host.rankedProjects(),
      home: os.homedir(),
      // Rides the snapshot because it changes for the snapshot's reasons: the
      // boot sweep finishes, or the user deletes one. Both of those already
      // call `broadcastTasks`.
      unclaimed: this.host.getUnclaimedWorktrees().map(({ path, branch, dirty }) => ({
        path, branch, dirty,
      })),
    };
  }

  /** The whole list — for a connect, or any change to which tasks exist. */
  broadcastTasks(): void {
    this.host.broadcastToAll(this.host.tasksSnapshot());
    this.host.reconcileWatchers();
  }

  /** One row changed. Cheaper than a snapshot, and the reason the protocol has
   * both: an agent transitioning state must not re-send every task. */
  broadcastTask(taskId: string): void {
    const info = this.host.taskInfo(taskId);
    if (info) this.host.broadcastToAll({ type: "task", task: info });
    // The single-row reconcile, because this is a hot path: ~34 sites call it,
    // among them `onTitleChange` — which fires per OSC sequence, undeduped and
    // many a second under a busy agent — and a loop in `detachClient`. Whatever
    // moved is this one row, and a row that has gone leaves a watcher only this
    // can stop.
    const row = this.host.store.get(taskId);
    if (row) this.host.reconcileWatcher(row);
    else this.host.stopWatcher(taskId);
  }

  getConnections(): Array<{ clientId: string; ptyIds: string[] }> {
    return [...this.connectedClients.keys()].map((clientId) => ({
      clientId,
      ptyIds: this.host.getClientPtyIds(clientId),
    }));
  }
}
