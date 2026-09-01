import { useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useTasks } from "../TaskContext";
import { buildTaskSlug } from "../utils/slug";

/** The composer's prompt box, addressed by id so the New task button can put
 * the caret in it from anywhere. Lives here rather than in `Composer` so that
 * focusing it does not mean importing the pane into the navigation hook. */
export const COMPOSER_PROMPT_ID = "composer-prompt";

/**
 * Open a task by id (§7.3).
 *
 * The slug is built here rather than by every caller, because building it needs
 * the task's current title and the callers — a sidebar row, the composer's
 * submit, a command palette entry — have only an id in hand. A task that is not
 * in the list yet has no title to slugify, so it is addressed by id alone; the
 * id is the whole address anyway, and the next render of the row will link to
 * the titled form.
 */
export function useOpenTask(): (taskId: string, options?: { tab?: string }) => void {
  const navigate = useNavigate();
  const { taskById } = useTasks();

  return useCallback(
    (taskId, options = {}) => {
      const task = taskById(taskId);
      const slug = task ? buildTaskSlug(task) : taskId;
      navigate({
        to: "/t/$slug",
        params: { slug },
        search: options.tab ? { tab: options.tab } : {},
      });
    },
    [navigate, taskById],
  );
}

/**
 * Open the composer (§7.5).
 *
 * The sidebar's New task button lands here and creates nothing. Everything a
 * task is decided by — project, model, permission mode, worktree — lives in the
 * composer, so a button that spawned one directly would be committing to every
 * one of those answers on the user's behalf, and to a promptless task besides.
 *
 * A project group's `+` passes that project's id and it rides along as
 * `?project=`, so the composer opens on the project the press was made under;
 * the header's `+` passes nothing and the composer opens wherever it would
 * have. Only ever an opinion about the selection — the composer is free to
 * ignore an id it does not recognise, and does.
 *
 * Focus is moved after the navigation rather than left to the pane's own
 * autofocus, because `/` may already be what is showing: nothing remounts then,
 * and the press would otherwise do nothing visible at all.
 */
export function useOpenComposer(): (options?: { projectId?: string }) => void {
  const navigate = useNavigate();

  return useCallback(
    (options = {}) => {
      // Focus only once the navigation has landed, and only if it did: a
      // navigation that rejects — blocked, or redirected out from under this —
      // leaves the caret where it was. Handled rather than left to float,
      // because nothing awaits this and an unhandled rejection is all the
      // report there would be.
      void Promise.resolve(
        navigate({
          to: "/",
          search: options.projectId ? { project: options.projectId } : {},
        }),
      ).then(
        () => document.getElementById(COMPOSER_PROMPT_ID)?.focus(),
        () => {},
      );
    },
    [navigate],
  );
}
