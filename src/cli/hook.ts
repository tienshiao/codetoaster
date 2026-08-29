// The reporter half of the hook loop (docs/v2-architecture.md §4.2). Claude
// Code runs this on every event we registered in the task's settings.json; it
// reads the payload from stdin and hands it to the daemon, which is what turns
// the task list from a 300ms output-activity guess into `busy` / `idle` /
// `needs_attention`.
//
// Three properties matter more than anything it actually does, because hooks
// run synchronously in the agent's own path:
//
//   1. It prints NOTHING to stdout. SessionStart stdout is injected into the
//      conversation as context, so a single stray line would poison every
//      turn of every task.
//   2. It always exits 0. A non-zero exit surfaces in the agent's transcript,
//      and nothing this process can discover is the agent's problem.
//   3. It gives up quickly. A daemon that is down, wedged, or listening on a
//      port that now belongs to someone else must never stall a keystroke.

/** One budget for the whole run, not per operation. */
const DEADLINE_MS = 1000;

/** Resolves to the payload, or undefined if stdin does not finish in time.
 * Bounded because there is no guarantee anything is attached: a hook invoked
 * with an open stdin would otherwise block until the settings-level timeout
 * killed it, once per event. */
async function readStdin(budgetMs: number): Promise<string | undefined> {
  return await Promise.race([
    Bun.stdin.text(),
    new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), budgetMs)),
  ]);
}

export async function cmdHook(): Promise<void> {
  try {
    const started = Date.now();
    const taskId = process.env.CODETOASTER_TASK_ID;
    const port = process.env.CODETOASTER_PORT;
    // Not our agent — someone ran `codetoaster hook` by hand, or the settings
    // file outlived the daemon that wrote it. Nothing to report it to.
    if (!taskId || !port) return;
    // Where the daemon told us it answers. Loopback is only the default, not a
    // safe assumption: `--host` binds one address exclusively, so a daemon on a
    // LAN address refuses `http://localhost:<port>` and every hook would be
    // dropped — leaving the task list back on the output-activity guess these
    // hooks exist to replace, silently, since we never report a failure.
    const origin = process.env.CODETOASTER_ORIGIN || `http://localhost:${port}`;

    const payload = await readStdin(DEADLINE_MS);
    // Nothing to say. An empty body is not a state transition, and posting one
    // only gives the daemon something to reject.
    if (!payload) return;

    const remaining = DEADLINE_MS - (Date.now() - started);
    if (remaining <= 0) return;

    // The body is the agent's payload untouched, with the task id in the path:
    // no wrapper for the daemon to unwrap, and no field of ours to fall out of
    // date when the payload shape changes. Unparseable input still goes — the
    // reporter is transport, not a validator, and one that quietly dropped
    // what it could not read would hide a payload change behind exactly the
    // tidy negative result §4.4 warns about.
    await fetch(`${origin}/api/tasks/${encodeURIComponent(taskId)}/hook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      signal: AbortSignal.timeout(remaining),
    });
  } catch {
    // Every failure is the same failure: the agent carries on regardless.
  }
}
