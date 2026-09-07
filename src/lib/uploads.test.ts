import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { collectUploads, ptyPathList, saveUploads, uploadsDir } from "./uploads";

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "codetoaster-uploads-"));
});

afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

/**
 * The guard on the guard, as `agent-bin.test.ts` is for the agent — and with
 * more at stake, because this module deletes.
 *
 * `test/preload.ts` pins `CODETOASTER_UPLOADS_DIR` at a temporary root for the
 * whole run, so no test that builds a `Harvester` on its defaults can collect
 * against the developer's own attachments. That protection is a line in
 * `bunfig.toml`, and CLAUDE.md records that bunfig's test options go quiet
 * under `bun run` — so it can stop working with nothing failing. This is what
 * says so.
 */
test("no test collects against the real staging directory", () => {
  expect(process.env.CODETOASTER_UPLOADS_DIR).toBeTruthy();
  expect(uploadsDir()).toBe(process.env.CODETOASTER_UPLOADS_DIR!);
  expect(uploadsDir().startsWith(os.homedir() + path.sep)).toBe(false);
});

describe("uploadsDir", () => {
  // The variable is pinned for every test (above), so what these ask is the
  // resolution underneath it.
  let pinned: string | undefined;
  beforeEach(() => {
    pinned = process.env.CODETOASTER_UPLOADS_DIR;
    delete process.env.CODETOASTER_UPLOADS_DIR;
  });
  afterEach(() => {
    process.env.CODETOASTER_UPLOADS_DIR = pinned;
  });

  test("sits beside the database it is scoped to", () => {
    // Two daemons on two databases must not share a staging root: each
    // collector judges a directory by its own rows, and would take the
    // other's attachments as unreferenced.
    expect(uploadsDir("/tmp/scratch/data.db")).toBe("/tmp/scratch/uploads");
    // The default database lands it where the docs say.
    expect(uploadsDir(path.join(os.homedir(), ".codetoaster", "data.db"))).toBe(
      path.join(os.homedir(), ".codetoaster", "uploads"),
    );
    expect(uploadsDir()).toBe(path.join(os.homedir(), ".codetoaster", "uploads"));
  });

  test("the override wins over both", () => {
    process.env.CODETOASTER_UPLOADS_DIR = "/elsewhere";
    expect(uploadsDir("/tmp/scratch/data.db")).toBe("/elsewhere");
  });
});

const HOUR = 60 * 60_000;
const NOW = 1_700_000_000_000;

/** A staging directory as `saveUploads` leaves one, aged by hand: `mtime` is
 * what the window is measured against, and a test cannot wait a week. */
async function staged(name: string, ageMs: number): Promise<string> {
  const [file] = await saveUploads([new File(["x"], name)], root);
  const dir = path.dirname(file!);
  const when = new Date(NOW - ageMs);
  fs.utimesSync(dir, when, when);
  return dir;
}

function collect(prompts: string[], olderThanMs = 24 * HOUR) {
  return collectUploads({ root, olderThanMs, now: NOW, prompts: () => prompts });
}

describe("saveUploads", () => {
  test("keeps the user's filename, under a directory of its own per call", async () => {
    const [first] = await saveUploads([new File(["a"], "shot.png")], root);
    const [second] = await saveUploads([new File(["b"], "shot.png")], root);
    expect(path.basename(first!)).toBe("shot.png");
    expect(path.basename(second!)).toBe("shot.png");
    // Same name, different call: a directory apart, so neither overwrites the
    // other and the path in each prompt still names what the user attached.
    expect(path.dirname(first!)).not.toBe(path.dirname(second!));
    expect(fs.readFileSync(first!, "utf8")).toBe("a");
    expect(fs.readFileSync(second!, "utf8")).toBe("b");
  });

  test("a traversing filename cannot write outside the staging directory", async () => {
    const escapee = path.join(root, "..", "pwned.txt");
    const [written] = await saveUploads([new File(["x"], "../pwned.txt")], root);
    expect(written!.startsWith(root + path.sep)).toBe(true);
    expect(path.basename(written!)).toBe("pwned.txt");
    expect(fs.existsSync(escapee)).toBe(false);
  });

  test("two files of one name in one call are both kept", async () => {
    // `image.png` from two different folders. Overwriting would hand the agent
    // the same file twice while the composer showed two chips.
    const paths = await saveUploads(
      [new File(["first"], "image.png"), new File(["second"], "image.png")],
      root,
    );

    expect(paths.map((p) => path.basename(p))).toEqual(["image.png", "image-2.png"]);
    expect(fs.readFileSync(paths[0]!, "utf8")).toBe("first");
    expect(fs.readFileSync(paths[1]!, "utf8")).toBe("second");
  });

  test("two names that differ only in case are two files", async () => {
    // APFS as macOS ships it is case-insensitive: `Shot.png` and `shot.png`
    // are one file there, and a case-sensitive set let the second overwrite
    // the first with two paths answered — the lost attachment again.
    const paths = await saveUploads(
      [new File(["upper"], "Shot.png"), new File(["lower"], "shot.png")],
      root,
    );

    expect(paths.map((p) => path.basename(p))).toEqual(["Shot.png", "shot-2.png"]);
    expect(fs.readFileSync(paths[0]!, "utf8")).toBe("upper");
    expect(fs.readFileSync(paths[1]!, "utf8")).toBe("lower");
  });

  test("the counter goes before the extension, and a dotfile has none", async () => {
    const paths = await saveUploads(
      [
        new File(["a"], "shot.png"), new File(["b"], "shot.png"), new File(["c"], "shot.png"),
        // A leading dot is the whole name, not a separator.
        new File(["d"], ".zshrc"), new File(["e"], ".zshrc"),
      ],
      root,
    );

    expect(paths.map((p) => path.basename(p))).toEqual([
      "shot.png", "shot-2.png", "shot-3.png", ".zshrc", ".zshrc-2",
    ]);
  });

  test("a name that basenames to nothing still lands as a file", async () => {
    const [dots] = await saveUploads([new File(["x"], "..")], root);
    expect(path.basename(dots!)).toBe("attachment");
    expect(fs.readFileSync(dots!, "utf8")).toBe("x");
  });
});

describe("ptyPathList", () => {
  test("a name with spaces stays one path", () => {
    // The case the feature exists for. Joined raw, this is five words and the
    // agent is handed no file at all.
    expect(ptyPathList([`${root}/Screenshot 2026-09-06 at 14.22.13.png`])).toBe(
      `'${root}/Screenshot 2026-09-06 at 14.22.13.png'`,
    );
  });

  test("an ordinary path is typed as itself", () => {
    // Quoting everything would work, and would put quotes in front of the
    // filename the user is meant to recognise.
    expect(ptyPathList([`${root}/shot.png`, `${root}/run.log`])).toBe(
      `${root}/shot.png ${root}/run.log`,
    );
  });

  test("a quote in the name cannot end the quoting", () => {
    expect(ptyPathList(["/tmp/it's here.png"])).toBe(`'/tmp/it'\\''s here.png'`);
  });
});

describe("collectUploads", () => {
  test("takes a directory that is old and named by nothing", async () => {
    const dir = await staged("stale.png", 8 * 24 * HOUR);

    expect(await collect(["a prompt about something else"])).toEqual([dir]);
    expect(fs.existsSync(dir)).toBe(false);
  });

  test("keeps one a prompt still names, however old", async () => {
    const dir = await staged("shot.png", 400 * 24 * HOUR);

    // A suspended conversation can be resumed and re-read, so the file its
    // opening turn points at is not ours to delete.
    expect(await collect([`what is wrong here\n\n${dir}/shot.png`])).toEqual([]);
    expect(fs.existsSync(dir)).toBe(true);
  });

  test("keeps one that is younger than the window even though nothing names it", async () => {
    const dir = await staged("shot.png", 1 * HOUR);

    // The create that will name it is still in flight. Without the age guard
    // the sweep races the request it is waiting on.
    expect(await collect([])).toEqual([]);
    expect(fs.existsSync(dir)).toBe(true);
  });

  test("reads no prompts on a tick with nothing old enough to weigh", async () => {
    await staged("shot.png", 1 * HOUR);
    let asked = 0;

    await collectUploads({
      root,
      olderThanMs: 24 * HOUR,
      now: NOW,
      prompts: () => { asked++; return []; },
    });

    // The usual tick on a machine that is not accumulating attachments: one
    // readdir, and no table scan behind it.
    expect(asked).toBe(0);
  });

  test("touches nothing that is not a uuid directory of ours", async () => {
    const old = new Date(NOW - 400 * 24 * HOUR);
    const byHand = path.join(root, "notes");
    fs.mkdirSync(byHand);
    fs.writeFileSync(path.join(byHand, "keep.txt"), "mine");
    fs.utimesSync(byHand, old, old);
    const loose = path.join(root, "loose.txt");
    fs.writeFileSync(loose, "mine too");
    fs.utimesSync(loose, old, old);

    expect(await collect([])).toEqual([]);
    expect(fs.existsSync(byHand)).toBe(true);
    expect(fs.existsSync(loose)).toBe(true);
  });

  test("a staging root that was never created is the state being asked for", async () => {
    fs.rmSync(root, { recursive: true, force: true });
    expect(await collect([])).toEqual([]);
  });

  test("weighs each directory on its own", async () => {
    const goes = await staged("orphan.png", 8 * 24 * HOUR);
    const staysNamed = await staged("named.png", 8 * 24 * HOUR);
    const staysYoung = await staged("fresh.png", 1 * HOUR);

    expect(await collect([`look at ${staysNamed}/named.png`])).toEqual([goes]);
    expect(fs.existsSync(goes)).toBe(false);
    expect(fs.existsSync(staysNamed)).toBe(true);
    expect(fs.existsSync(staysYoung)).toBe(true);
  });
});
