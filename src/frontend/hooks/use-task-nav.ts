import { useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useTasks } from "../TaskContext";
import { buildTaskSlug } from "../utils/slug";

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
