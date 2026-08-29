import { taskManager } from "../lib/tasks/manager";
import { isHookPayload } from "../lib/agent/hook-state";

// Where `codetoaster hook` reports to (docs/v2-architecture.md §4.2). This is
// the half of the loop that makes the task list informative: `busy` / `idle` /
// `needs_attention` is a precise signal from the agent itself, not the 300ms
// output-activity debounce v1 infers from PTY bytes.
//
// Everything answers 2xx. A hook's failure is reported into the agent's own
// transcript, so an unknown task, an event we do not map, and a body we cannot
// parse are all "accepted, changed nothing" — the reporter has nothing useful
// to do with an error, and the user has nothing useful to read in one.
export const hookRoutes = {
  "/api/tasks/:id/hook": {
    async POST(req: Request & { params: { id: string } }) {
      let payload: unknown;
      try {
        payload = await req.json();
      } catch {
        return new Response(null, { status: 204 });
      }
      if (!isHookPayload(payload)) return new Response(null, { status: 204 });

      const applied = taskManager.applyHook(req.params.id, payload);
      // 200 when the row moved, 204 when it did not. The reporter ignores
      // both; the difference is for anyone reading a log or a test.
      return new Response(null, { status: applied ? 200 : 204 });
    },
  },
};
