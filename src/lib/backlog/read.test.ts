import { test, expect, describe, afterEach } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { readBacklog, parseTaskFile, compareBacklogTasks } from "./read";
import type { BacklogTask } from "../../types/backlog";

// Fixtures are real directories, because everything under test is a question
// about the filesystem: which directories are read, which files are listed,
// what a path looks like relative to the root.
const roots: string[] = [];

function repo(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codetoaster-backlog-"));
  roots.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
}

const CONFIG = `project_name: "fixture"
statuses: ["To Do", "In Progress", "Done"]
task_prefix: "task"
`;

function taskFile(fm: string): string {
  return `---\n${fm}---\n\n## Description\n\nBody text.\n`;
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("readBacklog", () => {
  test("a repository with no backlog/config.yml is not a Backlog.md project", async () => {
    const root = repo({ "README.md": "# hi\n", "backlog/tasks/task-1 - Stray.md": taskFile("id: TASK-1\n") });
    expect(await readBacklog(root)).toEqual({ detected: false });
  });

  test("a missing directory entirely is not one either", async () => {
    expect(await readBacklog(path.join(os.tmpdir(), "codetoaster-backlog-does-not-exist"))).toEqual({
      detected: false,
    });
  });

  test("reports the uppercased prefix, the configured statuses in order, and every field", async () => {
    const root = repo({
      "backlog/config.yml": CONFIG,
      "backlog/tasks/task-7 - Do the thing.md": taskFile(
        `id: TASK-7
title: Do the thing
status: In Progress
assignee:
  - '@tma'
labels:
  - server
  - api
priority: high
ordinal: 7000
`
      ),
    });

    const result = await readBacklog(root);
    expect(result.detected).toBe(true);
    if (!result.detected) throw new Error("unreachable");
    expect(result.prefix).toBe("TASK");
    expect(result.statuses).toEqual(["To Do", "In Progress", "Done"]);
    expect(result.tasks).toEqual([
      {
        id: "TASK-7",
        title: "Do the thing",
        status: "In Progress",
        ordinal: 7000,
        priority: "high",
        labels: ["server", "api"],
        assignee: ["@tma"],
        path: "backlog/tasks/task-7 - Do the thing.md",
      },
    ]);
  });

  test("statuses keep the configured order rather than any alphabetical one", async () => {
    const root = repo({
      "backlog/config.yml": `statuses: ["Backlog", "Doing", "Shipped"]\ntask_prefix: "story"\n`,
    });
    const result = await readBacklog(root);
    if (!result.detected) throw new Error("expected detection");
    expect(result.statuses).toEqual(["Backlog", "Doing", "Shipped"]);
    expect(result.prefix).toBe("STORY");
  });

  test("a config without statuses or prefix falls back to Backlog.md's defaults", async () => {
    const root = repo({ "backlog/config.yml": `project_name: "bare"\n` });
    const result = await readBacklog(root);
    if (!result.detected) throw new Error("expected detection");
    expect(result.statuses).toEqual(["To Do", "In Progress", "Done"]);
    expect(result.prefix).toBe("TASK");
  });

  test("a config that will not parse still counts as detected", async () => {
    const root = repo({
      "backlog/config.yml": `statuses: [unclosed\ntask_prefix:: nope\n`,
      "backlog/tasks/task-1 - One.md": taskFile("id: TASK-1\ntitle: One\nordinal: 1000\n"),
    });
    const result = await readBacklog(root);
    if (!result.detected) throw new Error("expected detection");
    expect(result.statuses).toEqual(["To Do", "In Progress", "Done"]);
    expect(result.tasks.map((t) => t.id)).toEqual(["TASK-1"]);
  });

  test("orders by ordinal, then by numeric id — not lexical — with no ordinal last", async () => {
    const root = repo({
      "backlog/config.yml": CONFIG,
      "backlog/tasks/task-10 - Ten.md": taskFile("id: TASK-10\ntitle: Ten\nordinal: 5000\n"),
      "backlog/tasks/task-9 - Nine.md": taskFile("id: TASK-9\ntitle: Nine\nordinal: 5000\n"),
      "backlog/tasks/task-2 - Two.md": taskFile("id: TASK-2\ntitle: Two\nordinal: 1000\n"),
      "backlog/tasks/task-3 - Three.md": taskFile("id: TASK-3\ntitle: Three\n"),
      "backlog/tasks/task-1 - One.md": taskFile("id: TASK-1\ntitle: One\n"),
    });

    const result = await readBacklog(root);
    if (!result.detected) throw new Error("expected detection");
    // 2 (ordinal 1000), then 9 before 10 on the shared ordinal (numeric, not
    // lexical), then the two with no ordinal at all, between themselves by id.
    expect(result.tasks.map((t) => t.id)).toEqual(["TASK-2", "TASK-9", "TASK-10", "TASK-1", "TASK-3"]);
  });

  test("a folded title comes back as one line", async () => {
    const root = repo({
      "backlog/config.yml": CONFIG,
      "backlog/tasks/task-85 - Folded.md": taskFile(
        `id: TASK-85
title: >-
  Backlog section in the Explorer: Open and Closed, cards that open the task
  file
status: In Progress
ordinal: 85000
`
      ),
    });
    const result = await readBacklog(root);
    if (!result.detected) throw new Error("expected detection");
    expect(result.tasks[0]!.title).toBe(
      "Backlog section in the Explorer: Open and Closed, cards that open the task file"
    );
  });

  test("lists backlog/completed alongside backlog/tasks", async () => {
    const root = repo({
      "backlog/config.yml": CONFIG,
      "backlog/tasks/task-2 - Open.md": taskFile("id: TASK-2\ntitle: Open\nstatus: To Do\nordinal: 2000\n"),
      "backlog/completed/task-1 - Closed.md": taskFile("id: TASK-1\ntitle: Closed\nstatus: Done\nordinal: 1000\n"),
    });
    const result = await readBacklog(root);
    if (!result.detected) throw new Error("expected detection");
    expect(result.tasks.map((t) => [t.id, t.path])).toEqual([
      ["TASK-1", "backlog/completed/task-1 - Closed.md"],
      ["TASK-2", "backlog/tasks/task-2 - Open.md"],
    ]);
  });

  test("skips a file whose frontmatter will not parse, and one with none at all", async () => {
    const root = repo({
      "backlog/config.yml": CONFIG,
      "backlog/tasks/task-1 - Good.md": taskFile("id: TASK-1\ntitle: Good\nordinal: 1000\n"),
      "backlog/tasks/task-2 - Broken.md": taskFile("id: TASK-2\ntitle: [unclosed\n"),
      "backlog/tasks/notes.md": "# Just a note\n\nNo frontmatter here.\n",
      "backlog/tasks/task-4 - Idless.md": taskFile("title: No id at all\n"),
      "backlog/tasks/task-3 - Also good.md": taskFile("id: TASK-3\ntitle: Also good\nordinal: 3000\n"),
    });
    const result = await readBacklog(root);
    if (!result.detected) throw new Error("expected detection");
    expect(result.tasks.map((t) => t.id)).toEqual(["TASK-1", "TASK-3"]);
  });

  test("never reads archive or drafts", async () => {
    const root = repo({
      "backlog/config.yml": CONFIG,
      "backlog/tasks/task-1 - Live.md": taskFile("id: TASK-1\ntitle: Live\nordinal: 1000\n"),
      "backlog/archive/tasks/task-90 - Archived.md": taskFile("id: TASK-90\ntitle: Archived\nordinal: 90\n"),
      "backlog/archive/drafts/task-91 - Archived draft.md": taskFile("id: TASK-91\ntitle: Gone\n"),
      "backlog/drafts/task-92 - Draft.md": taskFile("id: TASK-92\ntitle: Draft\nordinal: 92\n"),
    });
    const result = await readBacklog(root);
    if (!result.detected) throw new Error("expected detection");
    expect(result.tasks.map((t) => t.id)).toEqual(["TASK-1"]);
  });

  test("a project with no tasks directory yet is still detected", async () => {
    const root = repo({
      "backlog/config.yml": CONFIG,
      "backlog/completed/task-1 - Closed.md": taskFile("id: TASK-1\ntitle: Closed\nordinal: 1000\n"),
    });
    const result = await readBacklog(root);
    if (!result.detected) throw new Error("expected detection");
    expect(result.tasks.map((t) => t.id)).toEqual(["TASK-1"]);
  });

  test("does not descend into subdirectories of tasks/", async () => {
    const root = repo({
      "backlog/config.yml": CONFIG,
      "backlog/tasks/task-1 - Live.md": taskFile("id: TASK-1\ntitle: Live\nordinal: 1000\n"),
      "backlog/tasks/nested/task-2 - Nested.md": taskFile("id: TASK-2\ntitle: Nested\nordinal: 2000\n"),
    });
    const result = await readBacklog(root);
    if (!result.detected) throw new Error("expected detection");
    expect(result.tasks.map((t) => t.id)).toEqual(["TASK-1"]);
  });
});

describe("parseTaskFile", () => {
  test("fills in the fields a file leaves out", () => {
    expect(parseTaskFile(taskFile("id: TASK-5\n"), "backlog/tasks/task-5.md")).toEqual({
      id: "TASK-5",
      title: "",
      status: "",
      ordinal: null,
      priority: null,
      labels: [],
      assignee: [],
      path: "backlog/tasks/task-5.md",
    });
  });

  test("a bare assignee string becomes a one-element list", () => {
    expect(parseTaskFile(taskFile("id: TASK-5\nassignee: '@tma'\n"), "p.md")!.assignee).toEqual(["@tma"]);
  });

  test("a non-string title is coerced rather than dropped", () => {
    // `title: 2026-09-04` parses as a date, and an unquoted number as a number.
    expect(parseTaskFile(taskFile("id: TASK-5\ntitle: 42\n"), "p.md")!.title).toBe("42");
  });

  test("a non-finite or non-numeric ordinal reads as none", () => {
    expect(parseTaskFile(taskFile("id: TASK-5\nordinal: soon\n"), "p.md")!.ordinal).toBeNull();
    expect(parseTaskFile(taskFile("id: TASK-5\nordinal: .inf\n"), "p.md")!.ordinal).toBeNull();
  });

  test("nothing usable is null, not a throw", () => {
    expect(parseTaskFile("no frontmatter\n", "p.md")).toBeNull();
    expect(parseTaskFile("---\nid: [unclosed\n---\n", "p.md")).toBeNull();
    expect(parseTaskFile("---\njust a scalar\n---\n", "p.md")).toBeNull();
    expect(parseTaskFile("---\n- a\n- b\n---\n", "p.md")).toBeNull();
    expect(parseTaskFile("---\nid: 5\n---\n", "p.md")).toBeNull();
    // An opening `---` that never closes is not frontmatter.
    expect(parseTaskFile("---\nid: TASK-5\n", "p.md")).toBeNull();
  });
});

describe("compareBacklogTasks", () => {
  function t(id: string, ordinal: number | null): BacklogTask {
    return { id, title: id, status: "", ordinal, priority: null, labels: [], assignee: [], path: `${id}.md` };
  }

  test("an id with no number in it sorts last", () => {
    const tasks = [t("bare", 1000), t("TASK-3", 1000)];
    tasks.sort(compareBacklogTasks);
    expect(tasks.map((x) => x.id)).toEqual(["TASK-3", "bare"]);
  });

  test("equal ordinals and equal ids leave the input order alone", () => {
    const tasks = [t("TASK-1", null), t("TASK-1", null)];
    expect(compareBacklogTasks(tasks[0]!, tasks[1]!)).toBe(0);
  });
});
