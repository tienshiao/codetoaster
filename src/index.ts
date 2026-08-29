import { parseArgs } from "util";

(async () => {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      port: { type: "string", short: "p" },
      host: { type: "string" },
      "allowed-host": { type: "string", multiple: true },
      db: { type: "string" },
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
  const allowedHosts = Array.isArray(values["allowed-host"])
    ? (values["allowed-host"] as string[])
    : undefined;

  switch (command) {
    case "":
      await cmdStart(port, dbPath, hostname, allowedHosts);
      break;
    case "foreground":
    case "fg":
      await cmdForeground(port, dbPath, hostname, allowedHosts);
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
