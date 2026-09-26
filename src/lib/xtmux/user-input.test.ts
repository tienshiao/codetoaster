import { test, expect, describe } from "bun:test";
import { isUserInput } from "./user-input";

// What xterm.js writes on its own through the same `input` message a
// keystroke uses (TASK-116). None of it is the user being here.
describe("the terminal talking by itself", () => {
  test.each([
    ["a focus-out report", "\x1b[O"],
    ["a focus-in report", "\x1b[I"],
    ["an OSC 11 reply ended by BEL", "\x1b]11;rgb:1e1e/1e1e/1e1e\x07"],
    ["an OSC 11 reply ended by ST", "\x1b]11;rgb:1e1e/1e1e/1e1e\x1b\\"],
    ["an SGR mouse report", "\x1b[<0;10;5M"],
    ["an X10 mouse report", "\x1b[M !!"],
    ["a cursor-position report", "\x1b[12;40R"],
    // Also Shift+F3, byte for byte; read as the report it more often is.
    ["a cursor-position report on row 1", "\x1b[1;2R"],
    ["a kitty keyboard flags report", "\x1b[?1u"],
    ["a device-attributes reply", "\x1b[?62;c"],
    ["a status report", "\x1b[0n"],
    ["a window-size report", "\x1b[8;24;80t"],
    ["a DCS reply", "\x1bP1$r0m\x1b\\"],
    ["several reports in one write", "\x1b[I\x1b]10;rgb:ffff/ffff/ffff\x07\x1b[O"],
    ["nothing", ""],
  ])("%s is not input", (_name, data) => {
    expect(isUserInput(data)).toBe(false);
  });
});

describe("a person typing", () => {
  test.each([
    ["a letter", "a"],
    ["Enter", "\r"],
    ["Ctrl-C", "\x03"],
    ["a bracketed paste", "\x1b[200~hello\x1b[201~"],
    ["a keystroke followed by a focus report", "x\x1b[O"],
    ["a report followed by a keystroke", "\x1b[Ix"],
    ["Alt+b", "\x1bb"],
    ["Backspace", "\x7f"],
    ["Tab", "\t"],
    ["Escape", "\x1b"],
    ["Escape after a focus report", "\x1b[I\x1b"],
    ["an arrow key", "\x1b[A"],
    ["Ctrl+Up", "\x1b[1;5A"],
    ["Shift+Tab", "\x1b[Z"],
    ["Home", "\x1b[H"],
    ["Delete", "\x1b[3~"],
    ["Page Down", "\x1b[6~"],
    ["an application-mode arrow key", "\x1bOA"],
    ["F1", "\x1bOP"],
    ["Shift+F1", "\x1b[1;2P"],
    ["Ctrl+F4", "\x1b[1;5S"],
    ["keypad Begin", "\x1b[E"],
    ["a kitty-protocol Ctrl+a", "\x1b[97;5u"],
    ["an arrow key after a focus report", "\x1b[I\x1b[B"],
  ])("%s is input", (_name, data) => {
    expect(isUserInput(data)).toBe(true);
  });
});
