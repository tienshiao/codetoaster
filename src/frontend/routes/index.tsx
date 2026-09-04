import { createFileRoute } from "@tanstack/react-router";
import { TaskShell } from "../components/TaskShell";
import { Composer } from "../components/Composer";

export const Route = createFileRoute("/")({
  // `project` is a preference the sidebar's per-project `+` expresses, not an
  // address: it says which project the composer should open on, and an id that
  // names no project is simply not honoured. So it is validated only as "a
  // string or absent" — whether it names a real project is the composer's
  // question, and its answer depends on a list that arrives over the socket
  // rather than on the URL. It is read on arrival only: moving the selection of
  // a composer already showing is `composer-request-store`'s job, since a press
  // of the `+` for the project this param already names changes nothing here
  // (TASK-82).
  validateSearch: (search: Record<string, unknown>): { project?: string } => ({
    project: typeof search.project === "string" && search.project ? search.project : undefined,
  }),
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
 *
 * What the main area holds instead is the composer: with no task selected, the
 * thing to do here is start one.
 */
function HomeRoute() {
  const { project } = Route.useSearch();
  return (
    <TaskShell taskId={null}>
      <Composer projectId={project} />
    </TaskShell>
  );
}
