import { test, expect, describe } from "bun:test";
import type { ILink, ILinkProvider } from "@xterm/xterm";
import {
  createCommitLinkProvider,
  createCommitResolver,
  findCommitLinks,
  ROW_CAP,
  type CommitFetch,
  type CommitResolver,
} from "./commit-links";

/**
 * The matcher behind commit-hash links in a terminal (TASK-110): what counts as
 * a hash in the output agents and git actually produce, and what the resolver
 * remembers about the answers.
 */

const SHORT = "31976f6";
const FULL = "31976f69c26b2181b9e8bc402eff248db6435c88";

const shas = (text: string) => findCommitLinks(text).map((m) => m.sha);

describe("the forms shas are printed in", () => {
  test("a bare abbreviation", () => {
    expect(shas(`fixed in ${SHORT}`)).toEqual([SHORT]);
  });

  test("a full hash", () => {
    expect(shas(`commit ${FULL}`)).toEqual([FULL]);
  });

  test("git log --oneline, which leads with one", () => {
    expect(shas(`${SHORT} fix: TASK-108 only a visible terminal`)).toEqual([SHORT]);
  });

  test("the bracket git commit prints", () => {
    expect(shas("[worktree-terminal-path-links 9ceb5a6]")).toEqual(["9ceb5a6"]);
  });

  test("both ends of a range", () => {
    expect(shas(`${SHORT}..9ceb5a6`)).toEqual([SHORT, "9ceb5a6"]);
  });

  test("a graph line's leading punctuation", () => {
    expect(shas(`| * ${SHORT} subject`)).toEqual([SHORT]);
  });

  test("a hash inside a forge URL", () => {
    expect(shas(`https://github.com/o/r/commit/${FULL}`)).toEqual([FULL]);
  });

  test.each([
    [`(${SHORT})`],
    [`\`${SHORT}\``],
    [`"${SHORT}"`],
    [`see ${SHORT}.`],
    [`${SHORT}, then`],
    [`${SHORT}:`],
    [`**${SHORT}**`],
  ])("punctuation around one: %s", (line) => {
    const [link, ...rest] = findCommitLinks(line);
    expect(rest).toEqual([]);
    expect(link?.sha).toBe(SHORT);
    expect(line.slice(link!.start, link!.end)).toBe(SHORT);
  });
});

describe("what is never a candidate", () => {
  test("under seven characters — git's own floor, and every CSS colour", () => {
    expect(shas("31976f and #a1b2c3 and #fff")).toEqual([]);
  });

  test("a longer hash, which has no window with a boundary on both sides", () => {
    // A 64-char sha-256: every 7-to-40 run inside it is flanked by more hex.
    expect(shas(`sha256:${"a".repeat(64)}`)).toEqual([]);
    expect(shas("f".repeat(41))).toEqual([]);
  });

  test("a uuid, whose segments are joined by the boundary character", () => {
    expect(shas("1b24c937-a98f-4d31-9af8-7156232c1d08")).toEqual([]);
  });

  test("uppercase hex — git writes none, and constants do", () => {
    expect(shas("DEADBEEF and 0xCAFEBABE")).toEqual([]);
  });

  test("hex run together with a word", () => {
    expect(shas("xdeadbee and deadbeex and v31976f6")).toEqual([]);
  });

  test("a task id, whose digits follow a dash", () => {
    expect(shas("filed TASK-1234567")).toEqual([]);
  });

  test("a word with a non-hex letter in it", () => {
    expect(shas("the resolver and something")).toEqual([]);
  });
});

test("a seven-digit number is a candidate — the repository settles it", () => {
  // Roughly one sha in twenty-seven is all digits, so excluding these to be rid
  // of `1234567` would quietly drop real ones. Asking is cheaper than guessing.
  expect(shas("took 1234567 ms")).toEqual(["1234567"]);
});

test("several on a line keep their own offsets", () => {
  const line = `${SHORT} then 9ceb5a6`;
  expect(findCommitLinks(line).map((m) => line.slice(m.start, m.end))).toEqual([SHORT, "9ceb5a6"]);
});

// ── the resolver ────────────────────────────────────────────────────────────

/** A stand-in repository: `commits` is what it knows, `calls` every batch it
 * was asked for, and `fail` makes the next request reject. */
function repository(commits: Record<string, string>) {
  const calls: string[][] = [];
  let fail = false;
  const fetchBatch: CommitFetch = async (shas) => {
    calls.push(shas);
    if (fail) throw new Error("offline");
    return Object.fromEntries(shas.flatMap((s) => (commits[s] ? [[s, commits[s]!]] : [])));
  };
  const resolver = createCommitResolver(fetchBatch);
  return {
    calls,
    resolver,
    resolve: resolver.resolve,
    peek: resolver.peek,
    breakIt: (broken: boolean) => {
      fail = broken;
    },
  };
}

test("a row is one request, and its answer maps abbreviations to full hashes", async () => {
  const repo = repository({ [SHORT]: FULL });
  expect([...(await repo.resolve([SHORT, "1234567"]))]).toEqual([[SHORT, FULL]]);
  expect(repo.calls).toEqual([[SHORT, "1234567"]]);
});

test("peek answers nothing until every sha on the row has been settled", async () => {
  const repo = repository({ [SHORT]: FULL });
  expect(repo.peek([SHORT])).toBeNull();

  await repo.resolve([SHORT]);
  expect([...repo.peek([SHORT])!]).toEqual([[SHORT, FULL]]);

  // One unknown among them sends the whole row the long way round.
  expect(repo.peek([SHORT, "1234567"])).toBeNull();
});

test("peek reports a settled miss as a miss, not as unknown", async () => {
  const repo = repository({});
  await repo.resolve(["1234567"]);
  expect([...repo.peek(["1234567"])!]).toEqual([]);
});

test("a failed request leaves peek unknown, so the next hover asks again", async () => {
  const repo = repository({ [SHORT]: FULL });
  repo.breakIt(true);
  await repo.resolve([SHORT]);
  expect(repo.peek([SHORT])).toBeNull();
});

test("a sha already answered is never asked about again, hit or miss", async () => {
  const repo = repository({ [SHORT]: FULL });
  await repo.resolve([SHORT, "1234567"]);
  const again = await repo.resolve([SHORT, "1234567"]);

  expect([...again]).toEqual([[SHORT, FULL]]);
  expect(repo.calls).toHaveLength(1);
});

test("only the shas it has not seen go into the next request", async () => {
  const repo = repository({ [SHORT]: FULL, "9ceb5a6": "9ceb5a62f7ec" });
  await repo.resolve([SHORT]);
  await repo.resolve([SHORT, "9ceb5a6"]);
  expect(repo.calls).toEqual([[SHORT], ["9ceb5a6"]]);
});

test("two rows in the same tick share one request", async () => {
  const repo = repository({ [SHORT]: FULL });
  const [a, b] = await Promise.all([repo.resolve([SHORT]), repo.resolve([SHORT])]);
  expect(repo.calls).toEqual([[SHORT]]);
  expect([...a!]).toEqual([[SHORT, FULL]]);
  expect([...b!]).toEqual([[SHORT, FULL]]);
});

test("a failed request is not remembered as a miss", async () => {
  const repo = repository({ [SHORT]: FULL });
  repo.breakIt(true);
  expect([...(await repo.resolve([SHORT]))]).toEqual([]);

  // The repository comes back; the sha must still be askable.
  repo.breakIt(false);
  expect([...(await repo.resolve([SHORT]))]).toEqual([[SHORT, FULL]]);
  expect(repo.calls).toHaveLength(2);
});

// ── the provider ────────────────────────────────────────────────────────────

function buffer(...lines: string[]) {
  return {
    buffer: {
      active: {
        getLine: (y: number) =>
          lines[y] === undefined ? undefined : { translateToString: () => lines[y]! },
      },
    },
  };
}

function provide(provider: ILinkProvider, y: number): Promise<ILink[] | undefined> {
  return new Promise((resolve) => provider.provideLinks(y, resolve));
}

/** A resolver that already knows everything, which is the steady state: `peek`
 * carries every row and `resolve` is never reached. */
function settled(commits: Record<string, string>): CommitResolver {
  const hits = (shas: string[]) =>
    new Map(shas.flatMap((s) => (commits[s] ? [[s, commits[s]!] as const] : [])));
  return { peek: hits, resolve: async (shas) => hits(shas) };
}

/** Its opposite: nothing is settled, so every row goes the long way. */
function unsettled(resolve: CommitResolver["resolve"]): CommitResolver {
  return { peek: () => null, resolve };
}

const KNOWN = settled({ [SHORT]: FULL });

test("the provider maps a match to 1-based inclusive ranges and opens the full sha", async () => {
  const opened: string[] = [];
  const provider = createCommitLinkProvider(
    buffer(`fixed in ${SHORT} today`),
    KNOWN,
    (sha) => opened.push(sha),
  );

  const links = await provide(provider, 1);
  expect(links?.map((l) => l.text)).toEqual([SHORT]);
  // [9, 16) 0-based → columns 10 through 16.
  expect(links![0]!.range).toEqual({ start: { x: 10, y: 1 }, end: { x: 16, y: 1 } });
  expect(links![0]!.decorations).toEqual({ pointerCursor: true, underline: true });

  links![0]!.activate({} as MouseEvent, links![0]!.text);
  // The abbreviation was clicked; the tab opens on the whole hash, so the same
  // commit written either way shares one tab.
  expect(opened).toEqual([FULL]);
});

test("a hex word the repository does not know is not a link", async () => {
  const links = await provide(
    createCommitLinkProvider(buffer(`${SHORT} and 1234567`), KNOWN, () => {}),
    1,
  );
  expect(links?.map((l) => l.text)).toEqual([SHORT]);
});

test("a known row answers in the same turn, so the click survives mousedown", () => {
  // Not a nicety: xterm captures the hovered link on mousedown and activates it
  // on mouseup, so an answer that arrives a microtask later is one it never
  // captured — the underline appears and the click does nothing.
  let links: ILink[] | undefined;
  let answered = false;
  createCommitLinkProvider(buffer(`fixed in ${SHORT}`), KNOWN, () => {}).provideLinks(1, (result) => {
    links = result;
    answered = true;
  });
  expect(answered).toBe(true);
  expect(links?.map((l) => l.text)).toEqual([SHORT]);
});

test("a row with nothing to ask about never reaches the resolver", async () => {
  let asked = 0;
  const count = unsettled(async (shas) => {
    asked += 1;
    return new Map(shas.map((s) => [s, FULL]));
  });
  expect(await provide(createCommitLinkProvider(buffer("no hashes here"), count, () => {}), 1)).toBeUndefined();
  expect(asked).toBe(0);
});

test("the provider offers nothing for a missing line, or when none resolve", async () => {
  expect(await provide(createCommitLinkProvider(buffer(SHORT), KNOWN, () => {}), 5)).toBeUndefined();
  expect(await provide(createCommitLinkProvider(buffer(SHORT), settled({}), () => {}), 1)).toBeUndefined();
});

test("a resolver that rejects leaves the row unlinked rather than throwing", async () => {
  const broken = unsettled(async () => {
    throw new Error("offline");
  });
  expect(await provide(createCommitLinkProvider(buffer(SHORT), broken, () => {}), 1)).toBeUndefined();
});

test("a row is asked about at most ROW_CAP hashes", async () => {
  let asked: string[] = [];
  const line = Array.from({ length: ROW_CAP + 5 }, (_, i) => `abcdef${i.toString(16)}0`).join(" ");
  const record = unsettled(async (shas) => {
    asked = shas;
    return new Map();
  });
  await provide(createCommitLinkProvider(buffer(line), record, () => {}), 1);
  expect(asked).toHaveLength(ROW_CAP);
});

test("a hash repeated on a row is asked about once", async () => {
  let asked: string[] = [];
  const record = unsettled(async (shas) => {
    asked = shas;
    return new Map(shas.map((s) => [s, FULL]));
  });
  const links = await provide(
    createCommitLinkProvider(buffer(`${SHORT}..${SHORT}`), record, () => {}),
    1,
  );
  expect(asked).toEqual([SHORT]);
  // Both occurrences still light up.
  expect(links).toHaveLength(2);
});
