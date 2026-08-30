import { useCallback, useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useTasks } from "../TaskContext";
import { TaskShell } from "../components/TaskShell";
import { parseTaskSlug } from "../utils/slug";

export const Route = createFileRoute("/t/$slug")({
  // `tab` is a tab key (`agent`, `diffAll`, `file:src/a.ts`, …). Validated only
  // as "a string or absent" here, because whether it names something openable
  // is `descriptorFromKey`'s question and its answer depends on the layout the
  // shell holds, not on the URL.
  validateSearch: (search: Record<string, unknown>): { tab?: string } => ({
    tab: typeof search.tab === "string" && search.tab ? search.tab : undefined,
  }),
  component: TaskRoute,
});

/**
 * `/t/$slug` and `/t/$slug?tab=<tabKey>` (§7.3).
 *
 * The slug's last 36 characters are the task id and its prefix is decoration,
 * so a link written before a rename still lands on the right task.
 */
function TaskRoute() {
  const { slug } = Route.useParams();
  const { tab } = Route.useSearch();
  const { id } = parseTaskSlug(slug);
  const { taskById, loaded } = useTasks();
  const navigate = useNavigate();

  // A slug for a task that no longer exists — a stale bookmark, or a task
  // closed on another client — goes home rather than showing an empty shell.
  // Gated on `loaded` because the task list arrives over the socket: without
  // it, every deep link would bounce to `/` in the frame before the first
  // `tasks` frame landed, which is every cold load.
  const missing = loaded && !taskById(id);
  useEffect(() => {
    if (missing) navigate({ to: "/", replace: true });
  }, [missing, navigate]);

  // Ensuring a tab is an instruction, carried out once. Clearing it with
  // `replace` keeps the address bar honest and keeps the instruction from
  // outliving itself: left in place, a back-navigation — or any later render
  // that reloaded the layout — would reopen a tab the user had since closed.
  const clearTab = useCallback(() => {
    navigate({ to: "/t/$slug", params: { slug }, search: {}, replace: true });
  }, [navigate, slug]);

  // Drawn with no task while the redirect lands, rather than with the id that
  // matched nothing. Not cosmetic: the shell loads and *saves* a layout for
  // whatever id it is handed, so rendering the dead one would honour `?tab=`
  // against it and leave a persisted layout behind for a task that is gone.
  // `/` draws the same empty shell, so there is no flash between the two.
  if (missing) return <TaskShell taskId={null} />;

  return <TaskShell taskId={id} pendingTab={tab ?? null} onTabEnsured={clearTab} />;
}
