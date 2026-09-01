import { useCallback, useState, type KeyboardEvent } from "react";
import { CornerDownLeft, Folder, GitBranch } from "lucide-react";
import { useTasks } from "@/frontend/TaskContext";
import { COMPOSER_PROMPT_ID, useOpenTask } from "@/frontend/hooks/use-task-nav";
import { Button } from "@/frontend/components/v2/Button";
import { Checkbox } from "@/frontend/components/v2/Checkbox";
import { KeyHint } from "@/frontend/components/v2/KeyHint";
import { Select } from "@/frontend/components/v2/Select";
import { knownValue, modelOptions, UNSET } from "@/frontend/lib/agent-options";
import { TextInput } from "@/frontend/components/v2/TextInput";
import { Textarea } from "@/frontend/components/v2/Textarea";

/** `""` is not a model — it is the absence of an override, which lets the
 * server answer with the project's column. */
const PROJECT_DEFAULT = UNSET;

const MODELS = modelOptions("Project default");

/**
 * Starting a task (§7.5).
 *
 * It renders where the tab area would be, with both sidebars still mounted:
 * starting a task and resuming one are the same gesture in the same place. No
 * "recent tasks" list belongs under it — the sidebar already is the history.
 *
 * The options row is project, model, worktree, base ref — everything a task is
 * decided by before it starts. Each sends nothing when it matches the
 * project's own answer, because the server resolves an absent field against
 * the project's columns and that is what gives the HTTP API and the CLI the
 * same behaviour for free (§7.5).
 *
 * Permission mode is not among them, and deliberately: the row offered a
 * `--permission-mode` picker that Claude Code is better placed to answer than
 * a chip on a form, so nothing here sets one and the agent keeps its own
 * default. The column, the `POST /api/tasks` field and the server's resolution
 * of them all survive — a mode set by the API or the CLI still spawns with it.
 *
 * `projectId` is what a project group's `+` in the sidebar asks for, carried
 * here as `/?project=<id>`. It is a preference and not an address: it seeds the
 * selection and every later change to it moves the selection, but an id that
 * names no project falls through the same fallback a deleted project's id does
 * and the composer opens on the first one. Nothing else is disturbed by it —
 * the prompt in particular, since the user can already be typing when the
 * request arrives.
 */

export interface ComposerProps {
  /** The project to open on, if the caller has an opinion (§7.5). */
  projectId?: string;
}

export function Composer({ projectId: requestedProjectId }: ComposerProps = {}) {
  const { projects, createTask } = useTasks();
  const openTask = useOpenTask();

  const [prompt, setPrompt] = useState("");
  const [projectId, setProjectId] = useState(requestedProjectId ?? "");
  const [model, setModel] = useState(PROJECT_DEFAULT);
  const [worktree, setWorktree] = useState(false);
  const [baseRef, setBaseRef] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // The same "adjust state when a prop changes" as the seeding below, for the
  // one prop that is a request rather than a fact: `/` is already showing when
  // a project group's `+` is pressed, so this never remounts and the new id
  // arrives as a changed prop into a live form. Only the selection moves — the
  // prompt is the user's and may already have been typed into, and it is the
  // only copy of it. Tracked by *what was last asked for* rather than by what
  // is selected, so a hand-made selection is not undone on every render, and so
  // asking for the same project twice after a detour still lands.
  const [lastRequested, setLastRequested] = useState(requestedProjectId ?? null);
  if ((requestedProjectId ?? null) !== lastRequested) {
    setLastRequested(requestedProjectId ?? null);
    if (requestedProjectId) setProjectId(requestedProjectId);
  }

  // The list arrives over the socket, so there is a first render with no
  // projects at all and the selection has to survive it: an id held from before
  // a project was deleted elsewhere is no longer a choice either — and neither
  // is a `?project=` naming one that never existed, which lands here too.
  const project = projects.find((p) => p.id === projectId) ?? projects[0];

  // React's own "adjust state when a prop changes": the model belongs to the
  // project it was read from, so it is re-seeded during the render that moves
  // the selection — including the one where the list first lands and picks the
  // first project. An effect would paint a frame of the previous project's
  // choices first, and ⌘⏎ in that frame would send them.
  const [seededFor, setSeededFor] = useState<string | null>(null);
  if (project && seededFor !== project.id) {
    setSeededFor(project.id);
    setModel(knownValue(MODELS, project.defaultModel));
    setWorktree(project.worktreeDefault);
    setBaseRef(project.defaultBaseRef ?? "");
  }

  // A project with nowhere to make one. "General" is the case in practice: it
  // has no directory, so a task in it runs wherever the daemon does and there
  // is no repository to add a worktree to. Disabled rather than hidden, so the
  // row does not reflow as the project selection moves.
  const canWorktree = Boolean(project?.initialPath);

  const canSubmit = prompt.trim().length > 0 && !submitting;

  const submit = useCallback(async () => {
    const text = prompt.trim();
    // An empty prompt is not a task. The button is disabled for it, and this
    // guard is what makes the keystroke inert too.
    if (!text || submitting) return;
    setSubmitting(true);
    setError(null);

    // Only what the user actually overrode goes on the wire: an absent field
    // means "whatever the project says", and `createTask` on the server is
    // where that is resolved — so the API and the CLI get the same answer.
    const result = await createTask(
      {
        prompt: text,
        projectId: project?.id,
        model: model || undefined,
        // Sent only when it differs from what the project would have done on
        // its own, so "I did not touch this" and "I chose the same thing"
        // stay the same request — and a project whose default later changes
        // moves the tasks that never overrode it.
        // A project with nowhere to branch is the exception: leaving the field
        // off there hands the decision back to a `worktree_default` the toggle
        // is showing as off and cannot honour, and the create fails with a 400
        // about a directory the user was never asked about. Said explicitly so
        // the request matches the control.
        worktree: !canWorktree
          ? (project?.worktreeDefault ? false : undefined)
          : worktree !== (project?.worktreeDefault ?? false)
            ? worktree
            : undefined,
        // Blank is not a ref, and the server refuses one. It is how this field
        // says "no override", which is exactly what leaving it out means.
        // `canWorktree` as well, and for the same reason the field above takes
        // it: a project whose `worktree_default` is on but has nowhere to
        // branch seeds the toggle to true while the control shows it off, and
        // a base ref sent alongside `worktree: false` describes a checkout this
        // request is not asking for.
        baseRef: worktree && canWorktree && baseRef.trim() ? baseRef.trim() : undefined,
        // The grid the agent is spawned at, before any client has attached and
        // so the only size the server has to go on. Left off, the agent paints
        // its opening banner at the 80×24 fallback and reflows the moment the
        // tab attaches at the real width.
        cols: 120,
        rows: 30,
      },
      // Inline, not a toast. This is a form: the message belongs under the
      // control that failed, next to the prompt still sitting in the box.
      // Toasting is what every other mutation wants, most of which are
      // fire-and-forget and have nowhere to put a message.
      { inline: true },
    );

    if (!result.ok) {
      // The prompt stays exactly as typed. It is the only copy of it, and a
      // failed create is precisely when the user needs it back.
      setError(result.error.message);
      setSubmitting(false);
      return;
    }
    // Left submitting: the navigation unmounts this, and until it does the
    // button must not take a second ⌘⏎.
    openTask(result.value.id, { tab: "agent" });
  }, [prompt, submitting, createTask, project, model, worktree, baseRef, canWorktree, openTask]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
      // Before the newline the textarea would otherwise insert.
      event.preventDefault();
      void submit();
    },
    [submit],
  );

  return (
    <div className="grid h-full place-items-center overflow-auto p-6">
      <div className="flex w-full max-w-[720px] flex-col gap-2.5">
        <Textarea
          // Addressed by id, and focused on mount: arriving at `/` — by the
          // sidebar's New task button or by any other route — means the user
          // is about to type. `useOpenComposer` focuses it by that id for the
          // case where `/` is already showing and this never remounts.
          id={COMPOSER_PROMPT_ID}
          autoFocus
          rows={5}
          value={prompt}
          placeholder="What should the agent do?"
          aria-label="Prompt"
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <div className="flex flex-wrap items-center gap-1.5">
          <Select
            label="project"
            icon={Folder}
            options={projects.map((p) => ({ value: p.id, label: p.name }))}
            value={project?.id ?? ""}
            onValueChange={setProjectId}
          />
          <Select
            label="model"
            options={MODELS}
            value={model}
            onValueChange={setModel}
          />
          <Checkbox
            variant="chip"
            label="worktree"
            checked={worktree && canWorktree}
            disabled={!canWorktree}
            title={
              canWorktree
                ? "Give this task a checkout of its own"
                : "This project has no directory to branch from"
            }
            onChange={(e) => setWorktree(e.target.checked)}
          />
          {/* Only alongside a worktree, because it decides nothing without
              one: a task running in the project's own checkout is on whatever
              branch the user left it on. Placeholder rather than a value, so
              an empty field reads as "the project's default" instead of
              claiming the project has none. */}
          {worktree && canWorktree ? (
            <label className="inline-flex h-control items-center gap-1.5 rounded-md border border-input bg-pane pl-2 pr-1.5 text-sm">
              <GitBranch size={13} className="flex-none text-muted-foreground" />
              <span className="flex-none text-muted-foreground">from</span>
              <TextInput
                aria-label="Base ref"
                value={baseRef}
                placeholder={project?.defaultBaseRef ?? "HEAD"}
                onChange={(e) => setBaseRef(e.target.value)}
                className="h-control w-28 border-0 bg-transparent px-0 focus:border-0"
              />
            </label>
          ) : null}
          <div className="ml-auto flex items-center gap-2">
            {error ? (
              <span role="alert" className="text-xs text-destructive">
                {error}
              </span>
            ) : null}
            <KeyHint keys={["⌘", "⏎"]} />
            <Button
              variant="primary"
              size="lg"
              icon={CornerDownLeft}
              disabled={!canSubmit}
              onClick={() => void submit()}
            >
              Start task
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
