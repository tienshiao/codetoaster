import { test, expect, describe } from "bun:test";
import { detailsOf } from "./task-details";
import type { TaskInfo } from "@/lib/xtmux/types";

/**
 * What reaches a row's hover card from a task (TASK-97).
 *
 * The card itself is asserted in `components/v2/TaskHoverCard.render.tsx`,
 * against the plain data. This is the other half: which of a `TaskInfo`'s
 * fields become that data, and — the part worth a test — which ones do not.
 * Every case below is a place where two fields could plausibly have been read
 * and only one of them is right.
 */

const PROJECTS = new Map([["website", "Website"]]);

function task(over: Partial<TaskInfo> = {}): TaskInfo {
  return {
    id: "t1",
    projectId: "website",
    ptyId: "pty-1",
    shellPtyIds: [],
    title: "website · main",
    titleSource: "derived",
    terminalTitle: "",
    agentState: "idle",
    profile: "claude",
    hooks: true,
    restarted: false,
    lifecycle: "live",
    cwd: "/Users/someone/projects/website",
    worktreePath: null,
    worktreeCwd: null,
    branch: null,
    lastMessage: null,
    clientCount: 0,
    size: { cols: 80, rows: 24 },
    createdAt: 1_000,
    lastActiveAt: 2_000,
    exited: false,
    hasNotification: false,
    worktreeState: "none",
    wipPending: false,
    worktree: null,
    ...over,
  };
}

describe("the path", () => {
  test("is the task's own checkout when it has one", () => {
    const details = detailsOf(
      task({ worktreePath: "/Users/someone/.codetoaster/worktrees/website/9f2c" }),
      "Fix the parser",
      "idle",
      PROJECTS,
    );
    expect(details.path).toBe("/Users/someone/.codetoaster/worktrees/website/9f2c");
  });

  test("is where the terminal actually is when it has not", () => {
    // `cwd`, not the project's initial path: the agent may have cd'd (§5.4),
    // and where it is now is the thing worth stating.
    expect(detailsOf(task(), "Fix the parser", "idle", PROJECTS).path).toBe(
      "/Users/someone/projects/website",
    );
  });

  test("is nothing at all for an archived task, whose directory was removed", () => {
    // `archiveTask` deletes the worktree and keeps `worktree_path` on the row,
    // so reporting it would name a directory that is not there — the same
    // reason the card suppresses the branch.
    const details = detailsOf(
      task({
        lifecycle: "archived",
        worktreeState: "present",
        worktreePath: "/Users/someone/.codetoaster/worktrees/website/9f2c",
      }),
      "Fix the parser",
      "exited",
      PROJECTS,
    );
    expect(details.path).toBeUndefined();
  });
});

describe("the branch", () => {
  test("comes off the row, so an unmeasured checkout still names one", () => {
    // The measurement costs a git process and arrives later; the branch is in
    // the database from the moment the checkout was made. Reading it out of
    // `worktree` would conflate "no branch" with "not measured yet".
    const details = detailsOf(
      task({ worktreeState: "evicted", branch: "task/fix-the-parser", worktree: null }),
      "Fix the parser",
      "idle",
      PROJECTS,
    );
    expect(details.branch).toBe("task/fix-the-parser");
    expect(details.dirty).toBeNull();
    expect(details.unpushed).toBe(0);
  });

  test("prefers the measurement once there is one", () => {
    const details = detailsOf(
      task({
        worktreeState: "present",
        branch: "task/fix-the-parser",
        worktree: { branch: "task/renamed", dirty: 3, unpushed: 2, merged: true },
      }),
      "Fix the parser",
      "idle",
      PROJECTS,
    );
    expect(details.branch).toBe("task/renamed");
    expect(details.dirty).toBe(3);
    expect(details.unpushed).toBe(2);
    expect(details.merged).toBe(true);
  });

  test("a dirty count git could not establish stays null, not zero", () => {
    const details = detailsOf(
      task({
        worktreeState: "present",
        worktree: { branch: "task/x", dirty: null, unpushed: 0, merged: false },
      }),
      "Fix the parser",
      "idle",
      PROJECTS,
    );
    expect(details.dirty).toBeNull();
  });

  test("is undefined, not null, for a task with no checkout of its own", () => {
    // Null is the card's "detached head", which is a checkout with something to
    // say. A task running in the project's own directory has none at all, and
    // the card must draw no Branch line rather than the word "detached".
    expect(detailsOf(task(), "x", "idle", PROJECTS).branch).toBeUndefined();
  });
});

describe("the state", () => {
  test("is qualified when the agent cannot report its own", () => {
    expect(detailsOf(task({ hooks: false }), "x", "busy", PROJECTS).stateNote).toBe(
      "inferred from output",
    );
  });

  test("is not qualified when it came from the agent", () => {
    expect(detailsOf(task(), "x", "busy", PROJECTS).stateNote).toBeUndefined();
  });

  test("is not qualified on an archived task, whose state is a lifecycle fact", () => {
    // `exited` there is because the task is archived, not because anything was
    // guessed from output — even on a profile that reports nothing.
    const details = detailsOf(
      task({ lifecycle: "archived", hooks: false }),
      "x",
      "exited",
      PROJECTS,
    );
    expect(details.archived).toBe(true);
    expect(details.stateNote).toBeUndefined();
  });
});

describe("what is left out", () => {
  test("the profile nobody chose", () => {
    expect(detailsOf(task(), "x", "idle", PROJECTS).profile).toBeUndefined();
    expect(detailsOf(task({ profile: "pi" }), "x", "idle", PROJECTS).profile).toBe("pi");
  });

  test("a terminal title that carries no content", () => {
    // A task whose program has reported no title at all, and — through
    // `meaningfulTitle` — one whose title is only the shell talking: a path, a
    // user@host, a bare program name. The same filter the row's label
    // projection uses, so the card cannot promote what the row refused.
    expect(detailsOf(task({ terminalTitle: "" }), "x", "idle", PROJECTS).terminalTitle)
      .toBeUndefined();
    expect(detailsOf(task({ terminalTitle: "bun test" }), "x", "idle", PROJECTS).terminalTitle)
      .toBe("bun test");
  });

  test("a project that has been deleted out from under the task", () => {
    expect(detailsOf(task({ projectId: "gone" }), "x", "idle", PROJECTS).project).toBeUndefined();
  });

  test("a last message the agent has not sent yet", () => {
    expect(detailsOf(task(), "x", "idle", PROJECTS).preview).toBeUndefined();
  });
});

test("the label is the displayed one, not the stored title", () => {
  // The card is a second look at the row, so it has to be a look at the same
  // name — the stored title is `website · main` here.
  expect(detailsOf(task(), "Fix the parser", "idle", PROJECTS).title).toBe("Fix the parser");
});

test("the timestamps and the viewer count are passed through as they are", () => {
  const details = detailsOf(
    task({ createdAt: 1_700_000_000_000, lastActiveAt: 1_700_000_600_000, clientCount: 2 }),
    "x",
    "idle",
    PROJECTS,
  );
  expect(details.createdAt).toBe(1_700_000_000_000);
  expect(details.lastActiveAt).toBe(1_700_000_600_000);
  expect(details.viewers).toBe(2);
});
