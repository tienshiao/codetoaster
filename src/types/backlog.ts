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
  /** The body of the `## Description` section, its marker comments stripped
   * and trimmed; `""` when there is none (TASK-114). Capped at 500 characters
   * with a trailing `…`: it ships for every task on every poll, and the hover
   * card clamps it long before that anyway. */
  description: string;
  /** Frontmatter `created_date` / `updated_date` as written. They carry no
   * timezone, so they are shown rather than parsed; null when absent. */
  createdDate: string | null;
  updatedDate: string | null;
  /** Frontmatter `dependencies`: the ids this task waits on. */
  dependencies: string[];
  /** Frontmatter `parent_task_id` for a subtask; null otherwise. */
  parent: string | null;
  /** Checked and total items of the `## Acceptance Criteria` checklist, and of
   * that section only — a checklist in the notes is not the criteria. Both 0
   * when the task has none. */
  acceptance: { done: number; total: number };
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
