import { createFileRoute } from "@tanstack/react-router";
import { TaskShell } from "../components/TaskShell";
import { Composer } from "../components/Composer";

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
 *
 * What the main area holds instead is the composer: with no task selected, the
 * thing to do here is start one.
 */
function HomeRoute() {
  return (
    <TaskShell taskId={null}>
      <Composer />
    </TaskShell>
  );
}
