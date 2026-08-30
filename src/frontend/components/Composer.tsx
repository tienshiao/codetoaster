import { useCallback, useState, type KeyboardEvent } from "react";
import { CornerDownLeft, Folder } from "lucide-react";
import { useTasks } from "@/frontend/TaskContext";
import { useOpenTask } from "@/frontend/hooks/use-task-nav";
import { Button } from "@/frontend/components/v2/Button";
import { KeyHint } from "@/frontend/components/v2/KeyHint";
import { Select, type SelectOption } from "@/frontend/components/v2/Select";
import { Textarea } from "@/frontend/components/v2/Textarea";

/** `""` is not a model — it is the absence of an override, which lets the
 * server answer with the project's column. Same for the mode. */
const PROJECT_DEFAULT = "";

const MODELS: SelectOption[] = [
  { value: PROJECT_DEFAULT, label: "Project default" },
  { value: "opus", label: "opus" },
  { value: "sonnet", label: "sonnet" },
  { value: "haiku", label: "haiku" },
];

const MODES: SelectOption[] = [
  { value: PROJECT_DEFAULT, label: "Project default" },
  { value: "default", label: "default" },
  { value: "acceptEdits", label: "acceptEdits" },
  { value: "plan", label: "plan" },
  { value: "bypassPermissions", label: "bypassPermissions" },
];

/** A seeded value the selects can actually display. A project column holding
 * something this build has no option for would otherwise leave the control
 * blank; "Project default" is both honest and identical in effect, since the
 * server resolves an absent field to that very column. */
function knownValue(options: SelectOption[], value: string | null): string {
  if (value && options.some((o) => o.value === value)) return value;
  return PROJECT_DEFAULT;
}

/**
 * Starting a task (§7.5).
 *
 * It renders where the tab area would be, with both sidebars still mounted:
 * starting a task and resuming one are the same gesture in the same place. No
 * "recent tasks" list belongs under it — the sidebar already is the history.
 *
 * The worktree toggle and base-ref select the design puts in the options row
 * are deliberately absent: a task's checkout only becomes a fact the server
 * knows in Phase 5, and a control over something nothing implements yet would
 * be a lie the user could click.
 */

export function Composer() {
  const { projects, createTask } = useTasks();
  const openTask = useOpenTask();

  const [prompt, setPrompt] = useState("");
  const [projectId, setProjectId] = useState("");
  const [model, setModel] = useState(PROJECT_DEFAULT);
  const [mode, setMode] = useState(PROJECT_DEFAULT);
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
  }

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
    const result = await createTask({
      prompt: text,
      projectId: project?.id,
      model: model || undefined,
      permissionMode: mode || undefined,
    });

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
  }, [prompt, submitting, createTask, project, model, mode, openTask]);

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
