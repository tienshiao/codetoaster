import { useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import { requestComposerProject } from "../composer-request-store";
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
 * task is decided by — project, model, worktree, base ref — lives in the
 * composer, so a button that spawned one directly would be committing to every
 * one of those answers on the user's behalf, and to a promptless task besides.
 *
 * A project group's `+` passes that project's id and it goes out twice: to the
 * request store, which is what actually moves the composer's selection, and
 * into the URL as `?project=` so the address opens on the same project when it
 * is reloaded or copied. The store is needed because the URL alone cannot
 * express a second press — `/?project=web` is already showing, the navigation
 * is a no-op, and the composer sees nothing (TASK-82). The header's `+` passes
 * nothing and the composer opens wherever it would have. Only ever an opinion
 * about the selection — the composer is free to ignore an id it does not
 * recognise, and does.
 *
 * Focus is moved after the navigation rather than left to the pane's own
 * autofocus, because `/` may already be what is showing: nothing remounts then,
 * and the press would otherwise do nothing visible at all.
 */
export function useOpenComposer(): (options?: { projectId?: string }) => void {
  const navigate = useNavigate();

  return useCallback(
    (options = {}) => {
      // Unconditionally, rather than inside the navigation's success branch
      // below: the store's own notify is what moves a composer already mounted
      // at `/`, so the request does not need the navigation to have landed —
      // and a navigation that never settles at all (a history blocker leaves
      // the promise pending) would swallow the press entirely.
      if (options.projectId) requestComposerProject(options.projectId);
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
