// What `GET /api/tasks/:id/backlog` answers (TASK-84). Shared by the route and
// the frontend, so the two cannot drift.

export interface BacklogTask {
  /** As written in the file: `TASK-82`, uppercased prefix and all. */
  id: string;
  title: string;
  status: string;
  /** Backlog.md's board order within a status; null when the file has none. */
  ordinal: number | null;
  priority: string | null;
  labels: string[];
  assignee: string[];
  /** The task's .md, relative to the repository root — what a card opens. */
  path: string;
}

export type BacklogResponse =
  | { detected: false }
  | {
      detected: true;
      /** The id prefix as ids are actually written (`TASK`, not the config's
       * lowercase `task`), so a client matching ids has the exact form. */
      prefix: string;
      /** In configured order; the last one is the terminal status. */
      statuses: string[];
      /** Ordered by ordinal ascending, then numeric id — Backlog.md's board
       * order. A client groups by status and keeps this order. */
      tasks: BacklogTask[];
    };
