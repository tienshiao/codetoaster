import { parseArgs } from "util";
// A leaf module with no imports of its own, so the hook fast path below pays
// nothing for it.
import { resolveDuration } from "./cli/duration";
// Erased at compile time, so it costs the hook fast path nothing at all.
import type { DaemonOptions } from "./cli/daemon";

(async () => {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      port: { type: "string", short: "p" },
      host: { type: "string" },
      "allowed-host": { type: "string", multiple: true },
      db: { type: "string" },
      "harvest-after": { type: "string" },
      "evict-after": { type: "string" },
      "uploads-after": { type: "string" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
    allowPositionals: true,
    strict: false,
  });

  const command = positionals[0] ?? "";

  // Dispatched before anything reaches ./cli/commands, and by dynamic import:
  // that module pulls in the server and its entire graph, ~90ms of startup a
  // hook has no use for. Hooks run synchronously in the agent's path and fire
  // on every prompt and every stop, so the cheapest possible path through this
  // file is the point.
  if (command === "hook") {
    const { cmdHook } = await import("./cli/hook");
    await cmdHook();
    // Always 0, and explicit: a stdin read that outlived its deadline is still
    // pending, and would otherwise hold the process open past the work.
    process.exit(0);
  }

  const {
    cmdStart,
    cmdForeground,
    cmdList,
    cmdKill,
    cmdConnections,
    cmdOpen,
    cmdStop,
    cmdStatus,
    cmdInstances,
    cmdHelp,
  } = await import("./cli/commands");

  if (values.help) {
    cmdHelp();
    process.exit(0);
  }

  if (values.version) {
    const version = typeof __VERSION__ !== "undefined" ? __VERSION__ : "dev";
    const hash = typeof __GIT_HASH__ !== "undefined" ? __GIT_HASH__ : "";
    console.log(`codetoaster ${version}${hash ? ` (${hash})` : ""}`);
    process.exit(0);
  }

  const port = typeof values.port === "string" ? parseInt(values.port, 10) : parseInt(process.env.PORT || "4000", 10);
  const dbPath = typeof values.db === "string" ? values.db : undefined;
  // Loopback unless asked otherwise: the daemon starts agents in the user's
  // repositories with nothing in front of it, so reachability is opt-in.
  const hostname = typeof values.host === "string" ? values.host : undefined;
  // Repeatable: a daemon on a wildcard bind cannot know which name reaches it.
  // Filtered to strings for the same reason `--host` is type-checked above:
  // under `strict: false`, a flag given no value parses as `true`, not as a
  // string — `--allowed-host` on its own yields `[true]`, and the guard lowercases
  // whatever it is handed. Unfiltered, that throws out of `configureOriginGuard`
  // *after* serve() is listening and reconcileOnBoot has suspended every task,
  // and before the pid file is written.
  const allowedHosts = Array.isArray(values["allowed-host"])
    ? values["allowed-host"].filter((name): name is string => typeof name === "string")
    : undefined;

  // Built only by the two commands that start a server, so a bad duration in
  // the environment cannot take `stop` or `list` down with it — a unit file
  // that exports CODETOASTER_HARVEST_AFTER wrongly must still let the user stop
  // the daemon it started. Resolved before anything is spawned, so a bad value
  // is a message and an exit rather than a detached child failing the same way
  // into a log file nobody is reading.
  function daemonOptions(): DaemonOptions {
    try {
      return {
        port,
        dbPath,
        hostname,
        allowedHosts,
        harvestAfterMs: resolveDuration(
          values["harvest-after"],
          process.env.CODETOASTER_HARVEST_AFTER,
          { flag: "--harvest-after", env: "CODETOASTER_HARVEST_AFTER" },
        ),
        evictAfterMs: resolveDuration(values["evict-after"], process.env.CODETOASTER_EVICT_AFTER, {
          flag: "--evict-after",
          env: "CODETOASTER_EVICT_AFTER",
        }),
        uploadsAfterMs: resolveDuration(
          values["uploads-after"],
          process.env.CODETOASTER_UPLOADS_AFTER,
          { flag: "--uploads-after", env: "CODETOASTER_UPLOADS_AFTER" },
        ),
      };
    } catch (e) {
      console.error((e as Error).message);
      process.exit(1);
    }
  }

  switch (command) {
    case "":
      await cmdStart(daemonOptions());
      break;
    case "foreground":
    case "fg":
      await cmdForeground(daemonOptions());
      break;
    case "list":
    case "ls":
      await cmdList(port);
      break;
    case "kill":
      if (!positionals[1]) {
        console.error("Usage: codetoaster kill <session>");
        process.exit(1);
      }
      await cmdKill(positionals[1], port);
      break;
    case "connections":
      await cmdConnections(port);
      break;
    case "open":
      await cmdOpen(port);
      break;
    case "stop":
      await cmdStop(port);
      break;
    case "status":
      await cmdStatus(port);
      break;
    case "instances":
      await cmdInstances();
      break;
    case "help":
      cmdHelp();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      cmdHelp();
      process.exit(1);
  }
})();
