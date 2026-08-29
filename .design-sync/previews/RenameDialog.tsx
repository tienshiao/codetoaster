import { RenameDialog } from "codetoaster";

const noop = () => {};

// Renaming a session from the sidebar context menu or the command palette.
// The field is seeded with the label currently on screen — for a session
// showing its terminal title, confirming that seed unedited pins it as the
// stored name.
export const RenameSession = () => (
  <RenameDialog
    item={{ id: "tsk_9f3c21", name: "codetoaster · v2" }}
    title="Rename Session"
    onRename={noop}
    onClose={noop}
  />
);

// The same dialog reused for a project, retitled.
export const RenameProject = () => (
  <RenameDialog
    item={{ id: "prj_04a7", name: "codetoaster" }}
    title="Rename Project"
    onRename={noop}
    onClose={noop}
  />
);

// A long stored name — `{dir} · {branch}` labels get long once a branch name
// does. Shows how the single field handles overflow.
export const LongName = () => (
  <RenameDialog
    item={{
      id: "tsk_71be40",
      name: "codetoaster · feature/two-phase-restore-for-suspended-tasks",
    }}
    title="Rename Session"
    onRename={noop}
    onClose={noop}
  />
);

// Cleared field: Rename is disabled until the name is non-empty.
export const EmptyName = () => (
  <RenameDialog
    item={{ id: "tsk_9f3c21", name: "" }}
    title="Rename Session"
    onRename={noop}
    onClose={noop}
  />
);
