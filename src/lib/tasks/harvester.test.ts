import { test, expect, describe, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import * as fs from "fs";
import type { ServerWebSocket } from "bun";
import { applyMigrations } from "../db";
import { TaskStore } from "./store";
import { TaskManager } from "./manager";
import { Harvester, SEVEN_DAYS_MS, THIRTY_MINUTES_MS, graceFor } from "./harvester";
import type { ServerMessage, WebSocketData } from "../xtmux/types";
import { taskDir, taskScrollbackPath } from "../agent/spawn";

// A client socket that records what the server sent it.
function fakeClient(id = "c1") {
  const received: ServerMessage[] = [];
  const ws = {
    send: (data: string) => { received.push(JSON.parse(data)); },
  } as unknown as ServerWebSocket<WebSocketData>;
  return {
    id,
    ws,
    received,
    of: (type: string) => received.filter((m) => m.type === type) as any[],
    last: (type: string) => [...received].reverse().find((m) => m.type === type) as any,
  };
}

async function waitFor(predicate: () => boolean | Promise<boolean>, ms = 4000): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return await predicate();
}

const managers: TaskManager[] = [];
const taskIds: string[] = [];

function newManager(): { manager: TaskManager; store: TaskStore; harvester: Harvester } {
  const db = new Database(":memory:");
  applyMigrations(db);
  const manager = new TaskManager(db);
  managers.push(manager);
  // Never started: a wall-clock interval would make every test here a race, and
  // `tick` is the same pass the interval runs.
  const harvester = new Harvester(manager);
  // Spelled out rather than inherited, even though it is now what the shipped
  // default happens to be. Every test below is about which tasks a *running*
  // harvester takes, and none of them is about the number: pinning it here
  // means a change to the default cannot quietly turn them into tests of
  // something else. The test that pins the default down builds its own
  // harvester instead.
  harvester.setHarvestAfter(THIRTY_MINUTES_MS);
  return { manager, store: new TaskStore(db), harvester };
}

/** A task id that gets its `~/.codetoaster/tasks/<id>` swept up afterwards.
 * Harvesting writes a scrollback file, so these tests leave real directories
 * behind under the user's home rather than in the database. */
function newTaskId(): string {
  const id = `test-${crypto.randomUUID()}`;
  taskIds.push(id);
  return id;
}

afterEach(async () => {
  // PTYs are real processes; a leaked one outlives the test run. `deleteTask`
  // rather than `closeTask`, which is a suspend now and would leave the row and
  // its directory behind for the next test to trip over.
  for (const manager of managers) {
    for (const id of taskIds) await manager.deleteTask(id);
  }
  managers.length = 0;
  for (const id of taskIds.splice(0)) fs.rmSync(taskDir(id), { recursive: true, force: true });
});

const HOUR_MS = 60 * 60_000;

/** A task that passes every guard in §5.5: live, idle for an hour, nobody
 * attached, and a terminal sitting at its own prompt. Each test below flips
 * exactly one of those and asserts the harvest does not happen.
 *
 * `cat` because it is the one thing that reliably does nothing: it holds the
 * PTY open, paints nothing, and is its own foreground process — a login shell
 * would run the user's rc files and could be doing anything at all when the
 * tick lands. */
async function harvestableTask(
  manager: TaskManager,
  store: TaskStore,
  command: string[] = ["cat"],
): Promise<string> {
  const id = newTaskId();
  await manager.createTask({ id, command });
  // Through the hook rather than straight into the row: `Stop` is what actually
  // makes a task idle in production, and it also records that hooks are working,
  // which stops the output heuristic from relabelling the task under the test.
  manager.applyHook(id, { hook_event_name: "Stop" });
  store.update(id, { idle_since: Date.now() - HOUR_MS });
  return id;
}

/** Nothing was harvested: the row still says live and the terminal is still
 * there to attach to. */
function stillRunning(manager: TaskManager, store: TaskStore, id: string): void {
  expect(store.get(id)!.lifecycle).toBe("live");
  const pty = manager.primaryPty(id);
  expect(pty).toBeDefined();
  expect(pty!.exited).toBe(false);
}

describe("the guards", () => {
  test("a task that satisfies all of them is harvested", async () => {
    const { manager, store, harvester } = newManager();
    const id = await harvestableTask(manager, store);

    await harvester.tick();

    expect(store.get(id)!.lifecycle).toBe("suspended");
  });

  test("a task that is not live is left alone", async () => {
    const { manager, store, harvester } = newManager();
    const id = await harvestableTask(manager, store);
    store.update(id, { lifecycle: "suspended" });

    await harvester.tick();

    // The lifecycle it was given, and — the part that matters — a terminal that
    // was not killed on the way to writing it again.
    expect(store.get(id)!.lifecycle).toBe("suspended");
    expect(manager.primaryPty(id)!.exited).toBe(false);
  });

  // A sweep can take seconds to reach a given task — the last guard spawns a
  // process per terminal — and a resume, a manual close or a user attaching in
  // the meantime is the more recent decision. So the guards read the row as it
  // stands, not the copy the listing handed over.
  test("a row that stopped being live after it was listed is left alone", async () => {
    const { manager, store, harvester } = newManager();
    const id = await harvestableTask(manager, store);
    // The listing says live and idle; the store has moved on since.
    const listed = { ...store.get(id)! };
    (manager as any).liveTasks = () => [listed];
    store.update(id, { lifecycle: "suspended" });

    await harvester.tick();

    // The lifecycle it was given, and — the part that matters — a terminal that
    // was not killed on the way to writing it again.
    expect(store.get(id)!.lifecycle).toBe("suspended");
    expect(manager.primaryPty(id)!.exited).toBe(false);
  });

  // The window that actually kills work: the row was idle when it was listed,
  // and the user submitted a prompt while the tick was walking towards it. The
  // agent is its own PTY's foreground process, so the `ps` guard sees nothing
  // running — the row is the only thing that knows.
  test("a task that went busy after it was listed is left alone", async () => {
    const { manager, store, harvester } = newManager();
    const id = await harvestableTask(manager, store);
    const listed = { ...store.get(id)! };
    (manager as any).liveTasks = () => [listed];
    manager.applyHook(id, { hook_event_name: "UserPromptSubmit" });

    await harvester.tick();

    stillRunning(manager, store, id);
  });

  // And the same window on the far side of the one await: a client that opened
  // the task while `ps` was answering is watching it.
  test("a task someone attached to while the guards ran is left alone", async () => {
    const { manager, store, harvester } = newManager();
    const id = await harvestableTask(manager, store);
    const client = fakeClient();
    manager.registerClient(client.id, client.ws);
    const pty = manager.primaryPty(id)!;
    const realCheck = pty.hasForegroundProcess.bind(pty);
    (pty as any).hasForegroundProcess = async () => {
      const answer = await realCheck();
      manager.attachClient(pty.id, client.id, client.ws, 80, 24);
      return answer;
    };

    await harvester.tick();

    stillRunning(manager, store, id);
  });

  // And the window the guards above cannot see at all, because it opens after
  // the last of them has answered: `suspendTask` awaits a snapshot write —
  // queued behind any earlier one for the task, so as long as a large screen
  // takes to reach the disk — and only then kills the PTYs. The daemon goes on
  // servicing WebSocket attaches throughout, and answers them `attached` and
  // `restore`. Without a guard on the inside of that call, the user watches the
  // terminal they just opened die.
  test("a task someone attached to during the snapshot write is left alone", async () => {
    const { manager, store, harvester } = newManager();
    const id = await harvestableTask(manager, store);
    const client = fakeClient();
    manager.registerClient(client.id, client.ws);
    const pty = manager.primaryPty(id)!;
    // After the screen is on disk and before the first kill — the exact
    // instant a click landing on this task would have been served.
    const realSnapshot = manager.snapshot.bind(manager);
    (manager as any).snapshot = async (taskId: string) => {
      const written = await realSnapshot(taskId);
      manager.attachClient(pty.id, client.id, client.ws, 80, 24);
      return written;
    };

    await harvester.tick();

    stillRunning(manager, store, id);
    // And the attach it raced is a live one, not a corpse the client is
    // holding: this is the whole complaint, that the terminal answered and
    // then died.
    expect(pty.getClientCount()).toBe(1);
  });

  // The other half of the contract. The guards are the harvester's alone, so a
  // user closing a task they are looking at must still close it — the very
  // condition that makes a harvest walk away.
  test("a manual close still suspends a task the closing client is attached to", async () => {
    const { manager, store, harvester } = newManager();
    const id = await harvestableTask(manager, store);
    const client = fakeClient();
    manager.registerClient(client.id, client.ws);
    const pty = manager.primaryPty(id)!;
    manager.attachClient(pty.id, client.id, client.ws, 80, 24);

    // The harvester refuses it, on the guard the close does not have.
    await harvester.tick();
    stillRunning(manager, store, id);

    expect(await manager.closeTask(id)).toBe(true);
    expect(store.get(id)!.lifecycle).toBe("suspended");
  });

  // A close arriving while a harvest of the same task is mid-write, where the
  // attach that prompts the close is also what makes the harvest walk away. If
  // the close simply joined the promise already in flight it would inherit that
  // refusal and report the user's click as a no-op.
  test("a close that lands during a harvest does not inherit its refusal", async () => {
    const { manager, store, harvester } = newManager();
    const id = await harvestableTask(manager, store);
    const client = fakeClient();
    manager.registerClient(client.id, client.ws);
    const pty = manager.primaryPty(id)!;

    let closed: Promise<boolean> | null = null;
    const realSnapshot = manager.snapshot.bind(manager);
    (manager as any).snapshot = async (taskId: string) => {
      const written = await realSnapshot(taskId);
      // The user clicks the task, then closes it, both inside the write.
      manager.attachClient(pty.id, client.id, client.ws, 80, 24);
      closed = manager.closeTask(id);
      return written;
    };

    await harvester.tick();

    expect(closed).not.toBeNull();
    expect(await closed!).toBe(true);
    expect(store.get(id)!.lifecycle).toBe("suspended");
  });

  // `idle` is the only state that means the agent said it stopped. Everything
  // else is either work in progress or an admission that we do not know.
  for (const state of ["busy", "needs_attention", "starting", "compacting", "unknown"] as const) {
    test(`a task that is ${state} is left alone`, async () => {
      const { manager, store, harvester } = newManager();
      const id = await harvestableTask(manager, store);
      store.update(id, { agent_state: state });

      await harvester.tick();

      stillRunning(manager, store, id);
    });
  }

  test("a task somebody is watching is left alone", async () => {
    const { manager, store, harvester } = newManager();
    const id = await harvestableTask(manager, store);
    const client = fakeClient();
    manager.registerClient(client.id, client.ws);
    manager.attachClient(manager.primaryPty(id)!.id, client.id, client.ws, 80, 24);

    await harvester.tick();

    stillRunning(manager, store, id);
  });

  test("a task that has not been idle long enough is left alone", async () => {
    const { manager, store, harvester } = newManager();
    const id = await harvestableTask(manager, store);
    store.update(id, { idle_since: Date.now() - 60_000 });
    harvester.setHarvestAfter(30 * 60_000);

    await harvester.tick();

    stillRunning(manager, store, id);
  });

  // Nobody ever saw this task stop working — an agent reporting no hooks, or a
  // `Stop` that never arrived. Counting from an unwritten column would suspend
  // it mid-turn.
  test("a task with no idle_since at all is left alone", async () => {
    const { manager, store, harvester } = newManager();
    const id = await harvestableTask(manager, store);
    store.update(id, { idle_since: null });

    await harvester.tick();

    stillRunning(manager, store, id);
  });

  test("a task with something running in a terminal is left alone", async () => {
    const { manager, store, harvester } = newManager();
    // An interactive shell, because job control is what puts a child in the
    // foreground: a non-interactive `sh -c` runs its command in its own process
    // group and looks exactly like an idle shell from outside.
    const id = await harvestableTask(manager, store, ["bash", "-i"]);
    const pty = manager.primaryPty(id)!;
    expect(await waitFor(async () => !(await pty.hasForegroundProcess()))).toBe(true);
    pty.write("sleep 30\n");
    expect(await waitFor(() => pty.hasForegroundProcess())).toBe(true);

    await harvester.tick();

    stillRunning(manager, store, id);
  });

  // TASK-27, and the guard §5.5 spells out as "no shell PTY in the task has a
  // foreground process other than the shell itself". The agent being idle says
  // nothing about a build the user started in a shell tab and walked away from,
  // and harvesting takes every one of the task's terminals down with it — so
  // the guard has to be asked of all of them, not of the agent alone.
  test("a task with something running in a shell tab is left alone", async () => {
    const { manager, store, harvester } = newManager();
    // The agent itself is the model citizen: idle, silent, nothing running.
    const id = await harvestableTask(manager, store);
    const shell = manager.openShell(id)!;
    expect(await waitFor(async () => !(await shell.hasForegroundProcess()))).toBe(true);
    shell.write("sleep 30\n");
    expect(await waitFor(() => shell.hasForegroundProcess())).toBe(true);

    await harvester.tick();

    stillRunning(manager, store, id);
    expect(shell.exited).toBe(false);
  });

  // The same reasoning for the other guard the shells have to be counted in:
  // one open tab anywhere in the task is somebody watching it.
  test("a task with a client attached to a shell tab is left alone", async () => {
    const { manager, store, harvester } = newManager();
    const id = await harvestableTask(manager, store);
    const shell = manager.openShell(id)!;
    const client = fakeClient();
    manager.registerClient(client.id, client.ws);
    manager.attachClient(shell.id, client.id, client.ws, 80, 24);

    await harvester.tick();

    stillRunning(manager, store, id);
  });

  // §9's risk 3, and the reason `hasForegroundProcess` answers `true` when it
  // cannot tell: a wedged mount, a killed `ps`, a machine under enough load to
  // miss the timeout. None of them are evidence that the terminal is empty.
  test("a terminal that cannot say what it is running blocks the harvest", async () => {
    const { manager, store, harvester } = newManager();
    const id = await harvestableTask(manager, store);
    const pty = manager.primaryPty(id)! as any;
    // What `runCapture` produces for a helper that failed, timed out, or is not
    // installed — every one of those reaches `getForegroundPid` as an empty
    // string and comes back undefined.
    pty.runCapture = async () => "";

    await harvester.tick();

    stillRunning(manager, store, id);
  });
});

describe("the timeout setting", () => {
  test("zero turns the harvester off without listing a single task", async () => {
    const { manager, store, harvester } = newManager();
    const id = await harvestableTask(manager, store);
    let listed = 0;
    const liveTasks = manager.liveTasks.bind(manager);
    (manager as any).liveTasks = () => { listed++; return liveTasks(); };

    harvester.setHarvestAfter(0);
    await harvester.tick();
    expect(listed).toBe(0);
    stillRunning(manager, store, id);

    // And turning it back on needs nothing restarted.
    harvester.setHarvestAfter(HOUR_MS / 2);
    await harvester.tick();
    expect(listed).toBe(1);
    expect(store.get(id)!.lifecycle).toBe("suspended");
  });

  test("defaults to §5.5's thirty minutes", async () => {
    const { manager, store } = newManager();
    const id = await harvestableTask(manager, store);
    // Deliberately not the switched-on harvester newManager hands back: this
    // is the one the daemon actually constructs, with no setHarvestAfter.
    const harvester = new Harvester(manager);

    // Idle for an hour, so it is past thirty minutes and not past two hours.
    // A default of 0 — which is what this shipped as until a suspended task
    // could be seen and reopened — would leave the task running.
    await harvester.tick();
    expect(store.get(id)!.lifecycle).toBe("suspended");

    const younger = await harvestableTask(manager, store);
    store.update(younger, { idle_since: Date.now() - 60_000 });
    await new Harvester(manager).tick();
    stillRunning(manager, store, younger);
  });

  test("a longer timeout keeps a task the default would have taken", async () => {
    const { manager, store, harvester } = newManager();
    const id = await harvestableTask(manager, store);
    harvester.setHarvestAfter(2 * HOUR_MS);

    await harvester.tick();

    stillRunning(manager, store, id);
  });
});

describe("harvesting", () => {
  test("writes the screen, kills every terminal, suspends the row, and says so", async () => {
    const { manager, store, harvester } = newManager();
    const client = fakeClient();
    manager.registerClient(client.id, client.ws);
    const id = await harvestableTask(manager, store, ["sh", "-c", "printf 'harvest me'; exec cat"]);
    const agent = manager.primaryPty(id)!;
    expect(await waitFor(() => agent.serialize().includes("harvest me"))).toBe(true);

    // A second terminal on the task: "every PTY of the task" is not an
    // assertion a single-terminal task can make.
    const shell = manager.openShell(id)!;
    client.received.length = 0;

    await harvester.tick();

    // The screen, on disk, from before the kill: `Pty.kill` disposes the
    // terminal and `serialize` answers "" afterwards, so a snapshot taken in
    // the wrong order would be empty or missing.
    expect(await Bun.file(taskScrollbackPath(id)).text()).toContain("harvest me");
    // Both terminals, and both directions of the association with them.
    expect(agent.isDisposed).toBe(true);
    expect(shell.isDisposed).toBe(true);
    expect(manager.getPty(agent.id)).toBeUndefined();
    expect(manager.getPty(shell.id)).toBeUndefined();
    expect(manager.taskIdForPty(agent.id)).toBeUndefined();
    expect(manager.taskIdForPty(shell.id)).toBeUndefined();
    expect(manager.primaryPty(id)).toBeUndefined();

    const row = store.get(id)!;
    expect(row.lifecycle).toBe("suspended");
    // The state the agent was last known to be in, not `unknown`: this daemon
    // watched it stop, and the card should go on saying so.
    expect(row.agent_state).toBe("idle");
    expect(row.last_size_cols).toBe(80);

    const delta = client.last("task");
    expect(delta.task).toMatchObject({ id, lifecycle: "suspended", ptyId: null });
    // One row, not the whole list.
    expect(client.of("tasks")).toHaveLength(0);
  });

  test("suspending keeps the row and the task's directory", async () => {
    const { manager, store, harvester } = newManager();
    // A terminal that has painted, because that is what puts a scrollback file
    // in the directory: an empty screen is nothing to write, and a task
    // harvested before its first paint keeps whatever snapshot it already had
    // rather than being given a blank one.
    const id = await harvestableTask(manager, store, ["sh", "-c", "printf 'harvest me'; exec cat"]);
    expect(await waitFor(() => manager.primaryPty(id)!.serialize().includes("harvest me"))).toBe(true);

    await harvester.tick();

    // Suspension is the reversible level of gone (§5.6): the row is what is
    // resumed and the directory is what it is resumed from.
    expect(store.get(id)).toBeDefined();
    expect(fs.existsSync(taskDir(id))).toBe(true);
    expect(fs.existsSync(taskScrollbackPath(id))).toBe(true);
  });

  test("a task that is already suspended is not harvested twice", async () => {
    const { manager, store } = newManager();
    const id = await harvestableTask(manager, store);

    expect(await manager.suspendTask(id)).toBe(true);
    expect(await manager.suspendTask(id)).toBe(false);
    expect(await manager.suspendTask("nope")).toBe(false);
  });

  // The hook grace timer is armed by every spawn, and when it fires it declares
  // a task that has reported nothing `unknown`. A suspended task reports
  // nothing by definition — there is no process left to report — so a timer
  // that outlived the harvest would wake up and relabel a task on the strength
  // of silence it caused itself.
  test("no clock survives the harvest to relabel the task", async () => {
    const { manager, store } = newManager();
    manager.setHookGrace(60);
    const id = newTaskId();
    await manager.createTask({ id, command: ["cat"] });
    expect(store.get(id)!.agent_state).toBe("starting");

    expect(await manager.suspendTask(id)).toBe(true);
    await Bun.sleep(150);

    expect(store.get(id)!.agent_state).toBe("starting");
  });
});

// AC #4. The tick is driven by an interval that gets no second chance at the
// tasks a throw skipped, and the task most likely to throw is the one whose
// neighbours most need looking at.
describe("robustness", () => {
  test("one task that throws does not stop the others being evaluated", async () => {
    const { manager, store, harvester } = newManager();
    const broken = await harvestableTask(manager, store);
    const healthy = await harvestableTask(manager, store);
    // Rows come back most recently active first, so this is the one the tick
    // reaches before it reaches the other — without which the test would pass
    // on a tick that gave up at the throw.
    store.update(broken, { last_active_at: Date.now() + 60_000 });
    (manager.primaryPty(broken)! as any).hasForegroundProcess = () => {
      throw new Error("ps is wedged");
    };

    await harvester.tick();

    stillRunning(manager, store, broken);
    expect(store.get(healthy)!.lifecycle).toBe("suspended");
  });

  test("a tick that cannot even list the tasks resolves rather than rejecting", async () => {
    const { manager, harvester } = newManager();
    (manager as any).liveTasks = () => { throw new Error("the database is gone"); };

    expect(await harvester.tick().then(() => "resolved", () => "rejected")).toBe("resolved");
  });

  test("start is idempotent and stop leaves nothing running", async () => {
    const { manager, store, harvester } = newManager();
    const id = await harvestableTask(manager, store);
    harvester.start();
    harvester.start();
    await harvester.stop();
    await harvester.stop();
    // Not a claim about the interval's period — only that stopping it leaves a
    // harvester nothing can wake up, and that saying so twice is safe. Both
    // answers resolve, since there is no tick to wait for.
    stillRunning(manager, store, id);
  });

  // Clearing the interval only stops the *next* sweep. The one already walking
  // the tasks is the hazard on the shutdown path: it awaits a snapshot, which
  // writes `scrollback.tmp` and renames it over the real file, so a
  // `process.exit` landing between the two orphans the staging file for as long
  // as the task exists.
  test("stop answers with the tick already running, so a shutdown can wait for it", async () => {
    const { manager, store, harvester } = newManager();
    const id = await harvestableTask(manager, store);
    // Held open where the real sweep is slow: the guard that spawns a `ps` per
    // terminal and waits up to two seconds for each.
    (manager.primaryPty(id)! as any).hasForegroundProcess = async () => {
      await Bun.sleep(100);
      return false;
    };

    const ticking = harvester.tick();
    await Bun.sleep(10);
    expect(store.get(id)!.lifecycle).toBe("live");

    await harvester.stop();

    // The sweep ran to its end rather than being abandoned where it stood.
    expect(store.get(id)!.lifecycle).toBe("suspended");
    await ticking;
  });
});

// The evict tier's policy (§5.6, TASK-39). What eviction *does* is tested
// against real repositories in `worktree.test.ts`; this is the arithmetic and
// the two switches, which are the parts that have no git in them.
describe("eviction grace", () => {
  // Priced in restore cost, not in age or disk. What the user pays for an
  // eviction is the wait when they come back, so the curve is the whole policy.
  test("scales with what the last restore cost", () => {
    // Nothing measured — no setup command, or setup that never finished — is
    // the base grace, not a penalty: a checkout with no setup really is nearly
    // free to rebuild.
    expect(graceFor(SEVEN_DAYS_MS, null)).toBe(SEVEN_DAYS_MS);
    expect(graceFor(SEVEN_DAYS_MS, 0)).toBe(SEVEN_DAYS_MS);
    // A restore that is over before the user notices is worth about as much as
    // no restore at all.
    expect(graceFor(SEVEN_DAYS_MS, 200)).toBeCloseTo(SEVEN_DAYS_MS, -7);
    // §5.6's own example: a 90-second install waits far longer than a 200ms one.
    expect(graceFor(SEVEN_DAYS_MS, 30_000)).toBe(2 * SEVEN_DAYS_MS);
    expect(graceFor(SEVEN_DAYS_MS, 90_000)).toBe(4 * SEVEN_DAYS_MS);
  });

  // Unbounded, one pathological setup — a container build, a dependency graph
  // fetched over a bad link — would pin its task on disk effectively forever,
  // which is the sprawl the tier exists to stop.
  test("is capped, however slow the setup was", () => {
    expect(graceFor(SEVEN_DAYS_MS, 60 * 60_000)).toBe(4 * SEVEN_DAYS_MS);
    expect(graceFor(SEVEN_DAYS_MS, Number.MAX_SAFE_INTEGER)).toBe(4 * SEVEN_DAYS_MS);
  });

  test("zero base disables the tier by arithmetic as well as by the guard", () => {
    expect(graceFor(0, 90_000)).toBe(0);
  });
});

describe("the two tiers are switched separately", () => {
  /** Which task lists a sweep actually consults. The tiers are disabled by not
   * doing the work, not by doing it and discarding the answer, so what is
   * observable is whether they looked. */
  function watchLists(manager: TaskManager) {
    const consulted = { live: false, suspended: false };
    const liveTasks = manager.liveTasks.bind(manager);
    const suspendedTasks = manager.suspendedTasks.bind(manager);
    (manager as any).liveTasks = () => { consulted.live = true; return liveTasks(); };
    (manager as any).suspendedTasks = () => { consulted.suspended = true; return suspendedTasks(); };
    return consulted;
  }

  // The regression this exists for. While there was one tier, `tick` returned
  // early on `harvestAfterMs <= 0` — and left in place that would let a user who
  // turned off idle harvesting silently turn off eviction with it. The two
  // settings answer different questions: one is about memory, the other disk.
  test("turning off idle harvesting leaves eviction running", async () => {
    const { manager, harvester } = newManager();
    const consulted = watchLists(manager);
    harvester.setHarvestAfter(0);

    await harvester.tick();

    expect(consulted.live).toBe(false);
    expect(consulted.suspended).toBe(true);
  });

  test("turning off eviction leaves idle harvesting running", async () => {
    const { manager, harvester } = newManager();
    const consulted = watchLists(manager);
    harvester.setEvictAfter(0);

    await harvester.tick();

    expect(consulted.live).toBe(true);
    expect(consulted.suspended).toBe(false);
  });

  test("both off is the only thing that skips the sweep entirely", async () => {
    const { manager, harvester } = newManager();
    const consulted = watchLists(manager);
    harvester.setHarvestAfter(0);
    harvester.setEvictAfter(0);

    await harvester.tick();

    expect(consulted).toEqual({ live: false, suspended: false });
  });
});
