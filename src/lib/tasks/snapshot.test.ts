import { test, expect, describe, afterEach } from "bun:test";
import * as fs from "fs";
import { readSnapshot, removeSnapshot, writeSnapshot } from "./snapshot";
import { taskDir, taskScrollbackPath } from "../agent/spawn";

const written: string[] = [];
function newTaskId(): string {
  const id = `test-${crypto.randomUUID()}`;
  written.push(id);
  return id;
}

afterEach(() => {
  for (const id of written.splice(0)) {
    fs.rmSync(taskDir(id), { recursive: true, force: true });
  }
});

describe("writeSnapshot", () => {
  test("creates the task's directory on demand and writes the file into it", async () => {
    const id = newTaskId();
    expect(fs.existsSync(taskDir(id))).toBe(false);

    await writeSnapshot(id, "hello");

    expect(fs.existsSync(taskScrollbackPath(id))).toBe(true);
    expect(await readSnapshot(id)).toBe("hello");
  });

  // The harvester writes the whole screen every tick, so anything that appended
  // would grow without bound and replay the task's history several times over.
  test("replaces what was there rather than adding to it", async () => {
    const id = newTaskId();
    await writeSnapshot(id, "the first, much longer screen");
    await writeSnapshot(id, "second");

    expect(await readSnapshot(id)).toBe("second");
  });

  // What is stored is the ANSI a terminal replays to get back to this screen.
  // Any transformation of the escape sequences on the way through would restore
  // a task to something the agent never painted.
  test("round-trips escape sequences untouched", async () => {
    const id = newTaskId();
    const screen = "\x1b[31mred\x1b[0m\r\n\x1b[1;32mbold green\x1b[m\x1b[2J\x1b[H";
    await writeSnapshot(id, screen);

    expect(await readSnapshot(id)).toBe(screen);
  });
});

describe("readSnapshot", () => {
  test("a task that has never been harvested has no snapshot", async () => {
    expect(await readSnapshot(newTaskId())).toBeUndefined();
  });

  test("a task whose directory exists but holds no snapshot has none either", async () => {
    const id = newTaskId();
    fs.mkdirSync(taskDir(id), { recursive: true });

    expect(await readSnapshot(id)).toBeUndefined();
  });
});

describe("removeSnapshot", () => {
  test("deletes the file", async () => {
    const id = newTaskId();
    await writeSnapshot(id, "hello");

    await removeSnapshot(id);

    expect(fs.existsSync(taskScrollbackPath(id))).toBe(false);
    expect(await readSnapshot(id)).toBeUndefined();
  });

  test("a missing file is the state it was asked for, not an error", async () => {
    const id = newTaskId();
    await removeSnapshot(id);
    await writeSnapshot(id, "hello");
    await removeSnapshot(id);
    await removeSnapshot(id);
  });
});
