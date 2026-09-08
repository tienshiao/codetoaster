import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { image2sixel } from "sixel";
import { Pty } from "./pty";
import type { ClientInfo, ServerMessage } from "./types";
import { TEST_SHELL } from "../../../test/shell";
import { waitFor } from "../../../test/wait";

// A sixel 25px wide and 45px tall: three cells by three against the
// canonical 10x20 cell, so the text after it lands three rows down.
function sixel(): string {
  const px = new Uint8Array(25 * 45 * 4);
  for (let i = 0; i < 25 * 45; i++) {
    px[i * 4 + 1] = 160;
    px[i * 4 + 3] = 255;
  }
  return image2sixel(px, 25, 45);
}

function client(id: string, received: ServerMessage[]): ClientInfo {
  return {
    id,
    ws: { send: (data: string) => received.push(JSON.parse(data)) } as unknown as ClientInfo["ws"],
    size: { cols: 80, rows: 24 },
  };
}

let dir: string;
let ptys: Pty[] = [];
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "codetoaster-images-"));
});
afterEach(async () => {
  for (const pty of ptys.splice(0)) pty.kill();
  await rm(dir, { recursive: true, force: true });
});

// The whole road, from a program painting a sixel to what a viewer is sent
// and what a later viewer is restored from. `cat` rather than `printf`
// because a sixel is a few hundred bytes of punctuation the shell would
// otherwise have to be talked out of interpreting. The newline before B is
// what every image tool prints last: the cursor is left on the image's
// last row, as the addon leaves it, and the newline is what gets below it.
test("a sixel reaches an attached viewer as an inline image and moves the prompt below it", async () => {
  const file = join(dir, "picture.six");
  await Bun.write(file, sixel());
  const received: ServerMessage[] = [];
  const pty = new Pty("images", [TEST_SHELL, "-c", `printf 'A\\n'; cat '${file}'; printf '\\nB\\n'; sleep 3`], 80, 24);
  ptys.push(pty);
  pty.addClient(client("viewer", received));

  const rows = () => pty.serialize().replace(/\x1b\]1337;[^\x1b]*\x1b\\/g, "<img>");
  expect(await waitFor(() => rows().includes("B"))).toBe(true);

  // What the viewer got: the image as an OSC 1337 with the cell box, never
  // the sixel itself.
  const data = received.filter((m) => m.type === "data").map((m) => (m as { data: string }).data).join("");
  expect(data).not.toContain("\x1bP");
  expect(data).toContain("\x1b]1337;File=inline=1;size=");
  expect(data).toContain(";width=3;height=3;preserveAspectRatio=0:");

  // What the server's grid says: A on row 0, the image from row 1, B on
  // the row after the image's last.
  const screen = rows();
  const a = screen.indexOf("A");
  const img = screen.indexOf("<img>");
  const b = screen.indexOf("B");
  expect(a).toBeGreaterThanOrEqual(0);
  expect(img).toBeGreaterThan(a);
  expect(b).toBeGreaterThan(img);
  // Two rows of nothing between the image's first row and B: the image's
  // second and third rows, which the serializer leaves as bare newlines.
  expect(screen.slice(img + "<img>".length, b)).toMatch(/^\x1b\[2A\r\x1b\[0m(\r\n){3}$/);

  // A viewer attaching now is restored from that, image included.
  const later: ServerMessage[] = [];
  pty.addClient(client("later", later));
  const restore = later.find((m) => m.type === "restore") as { data: string } | undefined;
  expect(restore?.data).toContain(";width=3;height=3;preserveAspectRatio=0:");
  expect(restore?.data.indexOf("A")).toBeLessThan(restore!.data.indexOf("\x1b]1337"));
});
