import { test, expect, describe, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppShell } from "./AppShell";
import { TaskHoverCard, type TaskRowDetails } from "./TaskHoverCard";
import { absoluteTime } from "@/frontend/utils/taskTimes";

/**
 * The hover card's contents (TASK-97, AC #6).
 *
 * What is worth asserting is the *projection*: which of a task's fields reach
 * the card, in what words, and — as much — which ones draw nothing. A card is
 * a second look at a row, so a line stating a zero, an unknown or a repeat of
 * what is already three lines above it is worse than an absent one.
 *
 * The card is forced open with the `open` prop rather than hovered. Radix's own
 * open delay is a `setTimeout` over pointer events, and happy-dom has no
 * pointer to move: a test driving it would be asserting Radix's timers, not
 * this component's content. The delay itself is verified in a browser.
 */

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** A now that the assertions can be written against. Timestamps below are
 * offsets from it, so "3m ago" is a claim about the card and not about how
 * long the test took to run. */
const NOW = Date.now();

function details(over: Partial<TaskRowDetails> = {}): TaskRowDetails {
  return {
    title: "Make the diff view stop re-tokenising on every keystroke",
    preview: "I have moved the tokenizer behind a cache keyed by file sha.",
    project: "codetoaster",
    state: "busy",
    path: "/Users/x/.codetoaster/worktrees/codetoaster/9f2c",
    branch: "feature/diff-cache",
    dirty: 3,
    unpushed: 2,
    createdAt: NOW - 6 * DAY,
    lastActiveAt: NOW - 3 * MINUTE,
    viewers: 2,
    ...over,
  };
}

function open(over: Partial<TaskRowDetails> = {}) {
  render(
    <TaskHoverCard open details={details(over)}>
      <div>row</div>
    </TaskHoverCard>,
  );
}

describe("what the row could not fit", () => {
  test("the title and the preview are shown whole", () => {
    open();

    // Both are truncated to one line in a 240px row. Neither is here.
    screen.getByText("Make the diff view stop re-tokenising on every keystroke");
    screen.getByText("I have moved the tokenizer behind a cache keyed by file sha.");
  });

  test("the project, path, branch and state are all named (AC #2)", () => {
    open();

    screen.getByText("codetoaster");
    screen.getByText("/Users/x/.codetoaster/worktrees/codetoaster/9f2c");
    screen.getByText("feature/diff-cache");
    screen.getByText("busy");
  });

  test("the checkout's counts keep the row's glyph language", () => {
    open();

    screen.getByLabelText("3 uncommitted files");
    screen.getByLabelText("2 unpushed commits");
  });

  test("who else has it open", () => {
    open();
    screen.getByText("2 viewing");
  });

  test("nobody viewing is no line, not '0 viewing'", () => {
    open({ viewers: 0 });
    expect(screen.queryByText(/viewing/)).toBeNull();
    expect(screen.queryByText("Viewers")).toBeNull();
  });
});

describe("times", () => {
  test("each is written both ways (AC #3)", () => {
    open();

    // Relative answers "is this stale"; absolute answers "was that the Tuesday
    // I was on this". The card carries both for each timestamp.
    screen.getByText("3m ago");
    screen.getByText("6d ago");
    screen.getByText(absoluteTime(NOW - 3 * MINUTE));
    screen.getByText(absoluteTime(NOW - 6 * DAY));
  });

  test("both timestamps are labelled, so neither is mistaken for the other", () => {
    open();

    screen.getByText("Created");
    screen.getByText("Active");
  });
});

describe("what is left out", () => {
  test("a card with no preview, project, branch or profile draws none of those lines", () => {
    open({
      preview: undefined,
      project: undefined,
      // Undefined, not null: this task has no checkout of its own. Null is the
      // detached head below, which does draw a line.
      branch: undefined,
      dirty: null,
      unpushed: 0,
      merged: false,
      profile: undefined,
    });

    expect(screen.queryByText("Project")).toBeNull();
    expect(screen.queryByText("Branch")).toBeNull();
    expect(screen.queryByText("Profile")).toBeNull();
    // And no zero standing in for a count nobody established.
    expect(screen.queryByLabelText(/uncommitted/)).toBeNull();
    expect(screen.queryByLabelText(/unpushed/)).toBeNull();
  });

  test("a clean detached head still draws the line, reading 'detached'", () => {
    // The task has a checkout — that is what `branch: null` says — and nothing
    // about it has moved. Collapsing that into "no branch line" would leave the
    // card silent about a worktree the row's own glyph is announcing.
    open({ branch: null, dirty: 0, unpushed: 0, merged: false });

    screen.getByText("Branch");
    screen.getByText("detached");
  });

  test("a profile is named only when someone chose one", () => {
    open({ profile: "pi" });
    screen.getByText("Profile");
    screen.getByText("pi");
  });

  test("the terminal title is dropped when it repeats the title or the preview", () => {
    open({ terminalTitle: "Make the diff view stop re-tokenising on every keystroke" });
    // Once, as the title — not twice.
    expect(
      screen.getAllByText("Make the diff view stop re-tokenising on every keystroke"),
    ).toHaveLength(1);
  });

  test("the terminal title is shown when it says something new", () => {
    open({ terminalTitle: "bun test --watch" });
    screen.getByText("bun test --watch");
  });
});

describe("the qualified state", () => {
  test("a task whose agent reports nothing says the state was inferred", () => {
    open({ state: "idle", stateNote: "inferred from output" });

    screen.getByText("idle");
    screen.getByText(/inferred from output/);
  });
});

describe("an archived task", () => {
  test("gets a card, and it says archived rather than describing a checkout (AC #5)", () => {
    open({ archived: true, state: "exited", branch: "feature/diff-cache", dirty: 3 });

    screen.getByText("archived");
    // The checkout is gone; naming its branch or counting files in it would be
    // describing something that is not on disk.
    expect(screen.queryByText("Branch")).toBeNull();
    expect(screen.queryByLabelText(/uncommitted/)).toBeNull();
  });
});

describe("closed", () => {
  test("nothing of the card is in the document until it opens", () => {
    render(
      <TaskHoverCard details={details()}>
        <div>row</div>
      </TaskHoverCard>,
    );

    // The row is; the card is not — including the fact block, which is what
    // would otherwise be mounted thirty times over for a sidebar nobody is
    // pointing at.
    screen.getByText("row");
    expect(
      screen.queryByText("Make the diff view stop re-tokenising on every keystroke"),
    ).toBeNull();
    expect(screen.queryByText("Project")).toBeNull();
    expect(screen.queryByText("3m ago")).toBeNull();
  });
});

describe("in the shell", () => {
  test("a row is drawn once whether or not it has a card or actions", () => {
    // Every row is wrapped the same way — for the card to anchor to and for the
    // actions to be positioned against — and a row given neither still has to
    // come out as one option, drawn once, not dropped for want of a key.
    render(
      <AppShell
        tasks={[
          { id: "a", title: "Plain row" },
          { id: "b", title: "Row with a card", details: details({ title: "Row with a card" }) },
          {
            id: "c",
            title: "Row with both",
            details: details({ title: "Row with both" }),
            actions: <button type="button">Close</button>,
          },
        ]}
      />,
    );

    expect(screen.getAllByRole("option")).toHaveLength(3);
    screen.getByRole("option", { name: /Plain row/ });
    screen.getByRole("option", { name: /Row with a card/ });
    screen.getByRole("button", { name: "Close" });
  });

  test("no card is open just for being in the list", () => {
    render(
      <AppShell tasks={[{ id: "b", title: "Row with a card", details: details() }]} />,
    );

    // Thirty rows in a sidebar are thirty cards that must not be mounted, let
    // alone drawn, until one row is pointed at.
    expect(screen.queryByText("Project")).toBeNull();
    expect(screen.queryByText("Created")).toBeNull();
  });
});

describe("on a device with no pointer", () => {
  test("the row is drawn bare, with no trigger wrapped around it", () => {
    // Radix's trigger calls `preventDefault()` on `touchstart`, which on a
    // phone would suppress the emulated click and stop the tap selecting the
    // task. A card that cannot open on touch anyway is not worth that, so it
    // is not mounted at all.
    vi.spyOn(window, "matchMedia").mockImplementation(
      (query: string) =>
        ({
          matches: false,
          media: query,
          onchange: null,
          addEventListener: () => {},
          removeEventListener: () => {},
          addListener: () => {},
          removeListener: () => {},
          dispatchEvent: () => false,
        }) as unknown as MediaQueryList,
    );

    render(
      <TaskHoverCard open details={details()}>
        <button type="button">Fix the parser</button>
      </TaskHoverCard>,
    );

    screen.getByRole("button", { name: "Fix the parser" });
    // Forced open and still nothing: the card is not merely closed here, it
    // does not exist.
    expect(screen.queryByText("Project")).toBeNull();
    expect(screen.queryByText("codetoaster")).toBeNull();
  });
});

describe("the trigger", () => {
  test("wraps the row rather than replacing it, and adds no box of its own", () => {
    render(
      <TaskHoverCard open details={details()}>
        <div data-testid="row" className="group/row relative">
          row
        </div>
      </TaskHoverCard>,
    );

    // `asChild`: the element the list laid out is still the element on screen,
    // with its own classes intact.
    const row = screen.getByTestId("row");
    expect(row.className).toContain("group/row");
  });
});
