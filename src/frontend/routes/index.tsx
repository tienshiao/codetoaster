import { createFileRoute } from "@tanstack/react-router";
import { TaskShell } from "../components/TaskShell";

export const Route = createFileRoute("/")({
  component: HomeRoute,
});

/**
 * `/` — the shell with no task selected (§7.3).
 *
 * Nothing is auto-opened here, and the v1 route's "jump to the first live
 * session" is deliberately not ported. Opening a task resumes it (§6), and
 * landing on `/` is not the user asking for that: after a restart
 * `reconcileOnBoot` suspends every task, so a redirect would spawn a
 * `claude --resume` for whichever task happened to sort first — on every page
 * load and every hot reload — and would take back the process the idle
 * harvester had just reclaimed. The sidebar has every task one click away,
 * which is where resuming one belongs.
 */
function HomeRoute() {
  return (
    <TaskShell taskId={null}>
      <NoTaskPlaceholder />
    </TaskShell>
  );
}

/** The main area before a task is picked. TASK-24 puts the composer here. */
function NoTaskPlaceholder() {
  return (
    <div className="grid h-full place-items-center text-sm text-subtle-foreground">
      Pick a task on the left.
    </div>
  );
}
