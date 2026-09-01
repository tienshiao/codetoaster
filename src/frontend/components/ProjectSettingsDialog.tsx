import { useCallback, useState, type ReactNode } from "react";
import type { ProjectInfo, ProjectSettings } from "../../lib/xtmux/types";
import { Checkbox } from "@/frontend/components/v2/Checkbox";
import { Dialog } from "@/frontend/components/v2/Dialog";
import { Select } from "@/frontend/components/v2/Select";
import { TextInput } from "@/frontend/components/v2/TextInput";
import { DirectoryBrowser, PathField } from "@/frontend/components/PathField";
import { Textarea } from "@/frontend/components/v2/Textarea";
import { knownValue, modelOptions } from "@/frontend/lib/agent-options";

// "Claude Code default", not "None": the empty choice does not turn the flag
// off, it declines to pass one, and what happens then is the agent's own
// business rather than ours.
const MODELS = modelOptions("Claude Code default");

/** A stacked label over a control, which is how `TextInput` and `Textarea`
 * already draw themselves.
 *
 * `Select` cannot use theirs: it *is* a `<label>` — the chip's words are part
 * of its hit area — and labels do not nest. So the text goes in a sibling span
 * and the control carries an `aria-label` of its own. Worth the duplication,
 * because a form that stacks its labels and inlines one reads as two forms that
 * happen to share a dialog. */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

export interface ProjectSettingsDialogProps {
  project: ProjectInfo;
  open: boolean;
  onClose: () => void;
  /** One call for the whole dialog. `updateProject` takes the name, the path
   * and the settings together, so saving them as one message is what keeps a
   * half-applied edit from leaving the row disagreeing with itself. */
  onSave: (name: string, initialPath: string, settings: Partial<ProjectSettings>) => void;
}

/**
 * What a project decides on behalf of the tasks started in it (§5.6, §7.5).
 *
 * Everything here is a *default*, and the composer can override every one of
 * them per task — which is why the empty choices read as "someone else
 * decides" rather than "off". The one field that is not a default is
 * `setup_command`, which always runs for a worktree this daemon creates.
 *
 * Not part of `SettingsDialog`. That one is per-device preference in
 * `localStorage` — theme, terminal font, sounds — and none of this is: it is
 * project state on the server, shared by every browser attached to the daemon.
 * Putting them in one dialog would put two different scopes of "setting" under
 * one title.
 *
 * The form is local until Save, so an abandoned edit changes nothing. Fields
 * are seeded when the dialog opens rather than held in sync with the project:
 * a broadcast landing mid-edit would otherwise overwrite what is being typed.
 */
export function ProjectSettingsDialog({
  project,
  open,
  onClose,
  onSave,
}: ProjectSettingsDialogProps) {
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [model, setModel] = useState("");
  const [baseRef, setBaseRef] = useState("");
  const [worktreeDefault, setWorktreeDefault] = useState(false);
  const [setupCommand, setSetupCommand] = useState("");
  const [worktreeCopy, setWorktreeCopy] = useState("");

  // Browsing swaps this dialog's body rather than opening a second one, the
  // same arrangement `NewProjectButton` uses and for the same reason: `Dialog`
  // binds Escape to the document and renders `fixed z-50`, so two of them would
  // dismiss together and leave their stacking to declaration order.
  const [browsing, setBrowsing] = useState(false);
  /** Whether the browser has been open once — only then should coming back to
   * the form pull focus, since the first open belongs to the Name field. */
  const [browsed, setBrowsed] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);

  const usePicked = useCallback((chosen: string) => {
    setPath(chosen);
    setPicked(null);
    setBrowsing(false);
  }, []);

  // Re-seeded on the render that opens the dialog, the same pattern the
  // composer uses for the project selection: an effect would paint one frame
  // of the previous project's values, and a fast Save in that frame would
  // store them.
  const [seededFor, setSeededFor] = useState<string | null>(null);
  const seedKey = open ? project.id : null;
  if (seededFor !== seedKey) {
    setSeededFor(seedKey);
    if (open) {
      setName(project.name);
      setPath(project.initialPath ?? "");
      setBrowsing(false);
      setBrowsed(false);
      setPicked(null);
      setModel(knownValue(MODELS, project.defaultModel));
      setBaseRef(project.defaultBaseRef ?? "");
      setWorktreeDefault(project.worktreeDefault);
      setSetupCommand(project.setupCommand ?? "");
      setWorktreeCopy(project.worktreeCopy ?? "");
    }
  }

  // Read off the field rather than the project: point a project at a
  // repository and the worktree settings become usable in the same breath,
  // without a save and a reopen to make the form agree with itself.
  const hasRepo = Boolean(path.trim());

  if (browsing) {
    return (
      <Dialog
        open={open}
        title="Choose a folder"
        confirmLabel="Use this folder"
        confirmDisabled={!picked}
        onConfirm={() => usePicked(picked!)}
        // Cancel and Escape mean "back to the form" here, not "abandon the
        // edit" — and that is also what makes confirming work without `Dialog`
        // growing a stay-open option, since it calls `onConfirm` and then
        // `onClose`, and the second is the same leave-browse-mode as the first.
        onClose={() => setBrowsing(false)}
        className="max-w-md"
      >
        <DirectoryBrowser initialPath={path} onSelectionChange={setPicked} onCommit={usePicked} />
      </Dialog>
    );
  }

  return (
    <Dialog
      open={open}
      title={`${project.name} settings`}
      description="What this project is, and what its tasks default to. The composer can override each default."
      confirmLabel="Save"
      // A project with no name is not one: it would leave the sidebar with an
      // empty header and the composer with a blank option.
      confirmDisabled={!name.trim()}
      onConfirm={() =>
        // Every field, every time: this is the whole form, so anything the
        // user cleared is meant to be cleared. Blank reaches the server as
        // "unset" rather than as an empty string.
        onSave(name.trim(), path.trim(), {
          defaultModel: model,
          defaultBaseRef: baseRef,
          worktreeDefault: hasRepo && worktreeDefault,
          setupCommand,
          worktreeCopy,
        })
      }
      onClose={onClose}
    >
      <TextInput
        id="project-name"
        label="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        data-1p-ignore
      />
      <PathField
        id="project-path"
        label="Repository path"
        value={path}
        placeholder="~/projects/website"
        autoFocus={browsed}
        onChange={setPath}
        onBrowse={() => {
          setPicked(null);
          setBrowsed(true);
          setBrowsing(true);
        }}
      />
      <Field label="Default model">
        <Select
          aria-label="Default model"
          options={MODELS}
          value={model}
          className="w-full"
          onChange={(e) => setModel(e.target.value)}
        />
      </Field>
      <Checkbox
        label="Give new tasks a worktree of their own"
        checked={hasRepo && worktreeDefault}
        disabled={!hasRepo}
        onChange={(e) => setWorktreeDefault(e.target.checked)}
      />
      <TextInput
        id="project-base-ref"
        label="Base ref for new worktrees"
        value={baseRef}
        disabled={!hasRepo}
        placeholder="HEAD"
        onChange={(e) => setBaseRef(e.target.value)}
      />
      <Textarea
        id="project-setup-command"
        label="Setup command"
        mono
        rows={2}
        value={setupCommand}
        disabled={!hasRepo}
        placeholder="bun install"
        onChange={(e) => setSetupCommand(e.target.value)}
      />
      <Textarea
        id="project-worktree-copy"
        label="Files to copy into a new worktree"
        mono
        rows={3}
        value={worktreeCopy}
        disabled={!hasRepo}
        placeholder={".env\n.env.local"}
        onChange={(e) => setWorktreeCopy(e.target.value)}
      />
      {!hasRepo ? (
        <p className="text-xs text-muted-foreground">
          This project has no directory, so its tasks run wherever the daemon does and there
          is no repository to make a worktree in.
        </p>
      ) : null}
    </Dialog>
  );
}
