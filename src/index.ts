import { parseArgs } from "util";
import {
  cmdStart,
  cmdForeground,
  cmdList,
  cmdKill,
  cmdConnections,
  cmdOpen,
  cmdStop,
  cmdStatus,
  cmdHelp,
} from "./cli/commands";

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    port: { type: "string", short: "p" },
    help: { type: "boolean", short: "h" },
    version: { type: "boolean", short: "v" },
  },
  allowPositionals: true,
  strict: false,
});

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
const command = positionals[0] ?? "";

switch (command) {
  case "":
    await cmdStart(port);
    break;
  case "foreground":
  case "fg":
    await cmdForeground(port);
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
    await cmdOpen();
    break;
  case "stop":
    await cmdStop(port);
    break;
  case "status":
    await cmdStatus(port);
    break;
  case "help":
    cmdHelp();
    break;
  default:
    console.error(`Unknown command: ${command}`);
    cmdHelp();
    process.exit(1);
}
