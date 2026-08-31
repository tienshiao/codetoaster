import { useCallback, useState, type KeyboardEvent } from "react";
import { CornerDownLeft, Folder, GitBranch } from "lucide-react";
import { useTasks } from "@/frontend/TaskContext";
import { useOpenTask } from "@/frontend/hooks/use-task-nav";
import { Button } from "@/frontend/components/v2/Button";
import { Checkbox } from "@/frontend/components/v2/Checkbox";
import { KeyHint } from "@/frontend/components/v2/KeyHint";
import { Select } from "@/frontend/components/v2/Select";
import {
  knownValue,
  MODEL_VALUES,
  optionsWithFallback,
  PERMISSION_MODE_VALUES,
  UNSET,
} from "@/frontend/lib/agent-options";
import { TextInput } from "@/frontend/components/v2/TextInput";
import { Textarea } from "@/frontend/components/v2/Textarea";

/** `""` is not a model — it is the absence of an override, which lets the
 * server answer with the project's column. Same for the mode. */
const PROJECT_DEFAULT = UNSET;

const MODELS = optionsWithFallback(MODEL_VALUES, "Project default");
const MODES = optionsWithFallback(PERMISSION_MODE_VALUES, "Project default");

/**
 * Starting a task (§7.5).
 *
 * It renders where the tab area would be, with both sidebars still mounted:
 * starting a task and resuming one are the same gesture in the same place. No
 * "recent tasks" list belongs under it — the sidebar already is the history.
 *
 * The options row is worktree, base ref, project, model, mode — everything a
 * task is decided by before it starts. All five send nothing when they match
 * the project's own answer, because the server resolves an absent field
 * against the project's columns and that is what gives the HTTP API and the
 * CLI the same behaviour for free (§7.5).
 */

export function Composer() {
  const { projects, createTask } = useTasks();
  const openTask = useOpenTask();

  const [prompt, setPrompt] = useState("");
  const [projectId, setProjectId] = useState("");
  const [model, setModel] = useState(PROJECT_DEFAULT);
  const [mode, setMode] = useState(PROJECT_DEFAULT);
  const [worktree, setWorktree] = useState(false);
  const [baseRef, setBaseRef] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // The list arrives over the socket, so there is a first render with no
  // projects at all and the selection has to survive it: an id held from before
  // a project was deleted elsewhere is no longer a choice either.
  const project = projects.find((p) => p.id === projectId) ?? projects[0];

  // React's own "adjust state when a prop changes": model and mode belong to
  // the project they were read from, so they are re-seeded during the render
  // that moves the selection — including the one where the list first lands and
  // picks the first project. An effect would paint a frame of the previous
  // project's choices first, and ⌘⏎ in that frame would send them.
  const [seededFor, setSeededFor] = useState<string | null>(null);
  if (project && seededFor !== project.id) {
    setSeededFor(project.id);
    setModel(knownValue(MODELS, project.defaultModel));
    setMode(knownValue(MODES, project.defaultPermissionMode));
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
        permissionMode: mode || undefined,
        // Sent only when it differs from what the project would have done on
        // its own, so "I did not touch this" and "I chose the same thing"
        // stay the same request — and a project whose default later changes
        // moves the tasks that never overrode it.
        worktree:
          canWorktree && worktree !== (project?.worktreeDefault ?? false) ? worktree : undefined,
        // Blank is not a ref, and the server refuses one. It is how this field
        // says "no override", which is exactly what leaving it out means.
        baseRef: worktree && baseRef.trim() ? baseRef.trim() : undefined,
        // The grid the agent is spawned at, before any client has attached and
        // so the only size the server has to go on. Left off, the agent paints
        // its opening banner at the 80×24 fallback and reflows the moment the
        // tab attaches at the real width. Same pair the sidebar's "new task"
        // sends, so the two doors produce the same task.
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
  }, [prompt, submitting, createTask, project, model, mode, worktree, baseRef, canWorktree, openTask]);

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
            onChange={(e) => setProjectId(e.target.value)}
          />
          <Select
            label="model"
            options={MODELS}
            value={model}
            onChange={(e) => setModel(e.target.value)}
          />
          <Select
            label="mode"
            options={MODES}
            value={mode}
            onChange={(e) => setMode(e.target.value)}
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
