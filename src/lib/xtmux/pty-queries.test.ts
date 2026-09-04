import { test, expect } from "bun:test";
import { Pty } from "./pty";
import { TEST_SHELL } from "../../../test/shell";
import { waitFor } from "../../../test/wait";

// A script standing in for a program that asks its terminal something and
// waits: it reads exactly the `bytes` of the reply it expects — raw, so the
// line discipline does not hold them for a newline that is never coming — and
// paints what it got, minus the leading ESC, so the headless terminal shows it
// as text rather than parsing it as the sequence it is.
function askingScript(query: string, bytes: number): string {
  return `printf '${query}'; IFS= read -r -s -t 4 -n ${bytes} reply; printf 'REPLY:%s:END\\n' "\${reply#?}"`;
}

function spawn(script: string): Pty {
  return new Pty("asking", [TEST_SHELL, "-c", script], 80, 24);
}

// Everything the terminal writes back into the PTY, in order.
function writesInto(pty: Pty): string[] {
  const writes: string[] = [];
  const write = pty.write.bind(pty);
  pty.write = (data: string) => {
    writes.push(data);
    write(data);
  };
  return writes;
}

// The headless terminal is the one a program is asking when it queries its
// terminal, and it is there before any client is. Its answers have to reach
// the PTY, or a program that waits for one before drawing never draws.
//
// The last case is fish's opening burst, byte for byte: the kitty keyboard
// probe, XTVERSION, an OSC 11 colour request and an XTGETTCAP — none of which
// the headless terminal answers — and then a Primary DA, which fish uses as
// the terminator for the lot. Only the DA has to come back for fish to reach a
// prompt; this is what every fish user's shell tab sat on (TASK-83).
const ASKED: Array<[name: string, query: string, bytes: number, reply: string]> = [
  ["a Primary DA", "\\033[c", 7, "[?1;2c"],
  ["a Secondary DA", "\\033[>c", 11, "[>0;276;0c"],
  ["fish's opening burst", "\\033[?u\\033[>0q\\033]11;?\\033\\\\\\033P+q544e\\033\\\\\\033[0c", 7, "[?1;2c"],
];

test.each(ASKED)("%s is answered with nobody attached", async (_name, query, bytes, reply) => {
  const pty = spawn(askingScript(query, bytes));
  try {
    let screen = "";
    expect(await waitFor(() => (screen = pty.serialize()).includes("REPLY:"))).toBe(true);
    expect(screen).toContain(`REPLY:${reply}:END`);
  } finally {
    pty.kill();
  }
});

// The one answer that is also a question. xterm replies to `CSI > c` with
// `CSI > 0;276;0 c`, which its own handler reads as another Secondary DA. That
// is harmless while the reply goes into the program, but a tty that reflects
// its input hands it back to the parser: here cooked mode with echo on and
// ECHOCTL off, so the reply comes back out as the bytes it is rather than as
// `^[`. One query became a reply on every reflection, without end, until
// `Pty` learnt that a request carries at most one parameter.
test("a Secondary DA the tty reflects back is answered once", async () => {
  const pty = spawn("stty -echoctl; printf '\\033[>c'; sleep 2");
  const writes = writesInto(pty);
  try {
    expect(await waitFor(() => writes.length > 0)).toBe(true);
    // Long enough for the reflection to have come back and been parsed.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(writes).toEqual(["\x1b[>0;276;0c"]);
  } finally {
    pty.kill();
  }
});
