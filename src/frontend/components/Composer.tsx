import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import { CornerDownLeft, Folder, GitBranch, Paperclip, Upload } from "lucide-react";
import { useTasks } from "@/frontend/TaskContext";
import {
  getComposerRequest,
  subscribeComposerRequest,
} from "@/frontend/composer-request-store";
import { useIsMobile } from "@/frontend/hooks/use-mobile";
import { uploadStaged } from "@/frontend/hooks/use-upload-mutation";
import { useProfiles } from "@/frontend/hooks/use-profiles";
import { COMPOSER_PROMPT_ID, useOpenTask } from "@/frontend/hooks/use-task-nav";
import {
  AttachmentStrip,
  releaseAttachment,
  toAttachment,
  type Attachment,
} from "@/frontend/components/AttachmentStrip";
import { promptWithAttachments } from "@/frontend/lib/attachments";
import { cn } from "@/frontend/lib/utils";
import { Button } from "@/frontend/components/v2/Button";
import { Checkbox } from "@/frontend/components/v2/Checkbox";
import { KeyHint } from "@/frontend/components/v2/KeyHint";
import { Select } from "@/frontend/components/v2/Select";
import {
  knownValue,
  modelOptions,
  profileOptions,
  UNSET,
} from "@/frontend/lib/agent-options";
// From `profile.ts`, which imports nothing, and not from the registry beside
// it, which reads the daemon's configuration off disk.
import { DEFAULT_PROFILE } from "@/lib/agent/profile";
import { TextInput } from "@/frontend/components/v2/TextInput";
import { Textarea } from "@/frontend/components/v2/Textarea";

/** `""` is not a model — it is the absence of an override, which lets the
 * server answer with the project's column. */
const PROJECT_DEFAULT = UNSET;

const MODELS = modelOptions("Project default");

export interface ComposerProps {
  /** The project to open on, if the caller has an opinion (§7.5). */
  projectId?: string;
}

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
 * `projectId` is what the composer opens on, carried here as `/?project=<id>`.
 * It is a preference and not an address: it seeds the selection on mount, so a
 * copied URL opens on the project it names, and an id that names no project
 * falls through the same fallback a deleted project's id does and the composer
 * opens on the first one. The selection is not written back to it.
 *
 * The prop keeps being followed after that mount, because it also *is* the
 * address: every `+` pushes a history entry, so Back and Forward move between
 * `/?project=web` and `/?project=general` — and a history navigation changes
 * this prop with nothing else happening at all. A composer that only read it
 * once would sit on the wrong project for the whole of that.
 *
 * `composer-request-store` answers the ask the address cannot express: a repeat
 * of the project it already names. Pressing web's `+` at `/?project=web` is a
 * navigation to the address already showing, so the prop does not move and only
 * the store's count does. The two coexist — a first press moves both for the
 * same id, which is two identical `setProjectId` calls — and a chip the user
 * moved by hand is clobbered by neither, since neither the prop nor the count
 * changes when nothing was pressed.
 *
 * Whichever way the ask arrives, only the selection moves: the prompt is the
 * user's and may already have been typed into, and it is the only copy of it.
 */
export function Composer({ projectId: requestedProjectId }: ComposerProps = {}) {
  const { projects, createTask } = useTasks();
  const openTask = useOpenTask();
  const isMobile = useIsMobile();
  // What this daemon can actually run a task on, rather than a list compiled
  // in: `profiles.json` can add one (TASK-89.2). Undefined until it lands, and
  // the options below are the unset choice alone for that first frame — which
  // is what the control already holds and what an untouched submit sends.
  const { data: profiles } = useProfiles();
  const PROFILES = profileOptions(profiles, "Project default");

  const [prompt, setPrompt] = useState("");
  const [projectId, setProjectId] = useState(requestedProjectId ?? "");
  const [model, setModel] = useState(PROJECT_DEFAULT);
  const [touchedProfile, setProfile] = useState<string | null>(null);
  const [worktree, setWorktree] = useState(false);
  const [baseRef, setBaseRef] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Files held until submit (TASK-93). Nothing is written to disk while they
  // sit here, so a composer the user walks away from leaves no orphans behind
  // and there is no cleanup pass to own; the cost is that a large paste is
  // uploaded at ⌘⏎ rather than in the background before it.
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Nested drag targets fire `dragleave` on the way *in* to a child, so the
  // overlay has to count enters rather than trust the last event — the same
  // arrangement the terminal's drop target uses.
  const [dragDepth, setDragDepth] = useState(0);
  const dragOver = dragDepth > 0;

  // Every object URL still held when this unmounts, released. Through a ref
  // because the effect must not re-run per attachment — a dependency on the
  // list would revoke the URLs of the chips still on screen the moment the
  // next one is added, and the thumbnails would go blank. `removeAttachment`
  // reads the same ref for the current list.
  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;
  useEffect(() => () => attachmentsRef.current.forEach(releaseAttachment), []);

  const addFiles = useCallback(
    (files: File[]) => {
      // Nothing joins the list once the submit is under way: it snapshotted
      // the attachments before awaiting the upload, so a file added now would
      // be uploaded by nobody and named in no prompt — silently dropped.
      if (submitting || files.length === 0) return;
      setAttachments((current) => [...current, ...files.map(toAttachment)]);
    },
    [submitting],
  );

  const removeAttachment = useCallback((id: string) => {
    // Released outside the updater: React may run one twice, and revoking the
    // same object URL from a re-run is a side effect in a place that must not
    // have any.
    const going = attachmentsRef.current.find((a) => a.id === id);
    if (going) releaseAttachment(going);
    setAttachments((current) => current.filter((a) => a.id !== id));
  }, []);

  // Two "adjust state when a prop changes" branches, and they answer different
  // questions.
  //
  // The first follows the address. `?project=` changing on a mounted composer
  // is a history navigation — Back or Forward across the entries each `+`
  // pushed, including Back to a plain `/` — and nothing else happens then: no
  // remount to re-read the seed above, and no request in the store either.
  const [lastRequested, setLastRequested] = useState(requestedProjectId ?? null);
  if ((requestedProjectId ?? null) !== lastRequested) {
    setLastRequested(requestedProjectId ?? null);
    // Only when it names one. Back to `/` is the address dropping its
    // preference, not an instruction to move the chip anywhere.
    if (requestedProjectId) setProjectId(requestedProjectId);
  }

  // The second is for the ask the address cannot carry: a press of the `+` for
  // the project `?project=` already names is a navigation to the address
  // already showing, so the prop above is inert and the composer would see
  // nothing (TASK-82). Keyed on the store's count and not on the id it carries,
  // because that press names a project the composer may well be showing already
  // — the user having moved the chip by hand since — and comparing ids would
  // read it as nothing having been asked for.
  //
  // The two overlap harmlessly: a first press moves both for the same id, which
  // is two identical `setProjectId` calls. Either way only the selection moves;
  // the prompt is untouched, since the user can already be typing when the
  // request arrives.
  const request = useSyncExternalStore(
    subscribeComposerRequest,
    getComposerRequest,
    getComposerRequest,
  );
  const [seenSeq, setSeenSeq] = useState(request.seq);
  if (request.seq !== seenSeq) {
    setSeenSeq(request.seq);
    if (request.projectId) setProjectId(request.projectId);
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
    // Back to untouched, not to a value: what the agent chip shows is derived
    // from this project and the fetched list below.
    setProfile(null);
    setWorktree(project.worktreeDefault);
    setBaseRef(project.defaultBaseRef ?? "");
  }

  // Derived rather than seeded, unlike the three fields above it, because its
  // options arrive over the network: `knownValue` against a list that has not
  // landed answers "unset" for every project, so a value stored when the
  // selection moved would show "Project default" over a project that has one —
  // and would never correct itself, since the selection is not what changed
  // when the answer came back. Read every render, it simply becomes right.
  //
  // `null` is "the user has not touched this", which is not the empty choice:
  // that is a deliberate "let the project decide", and it has to survive the
  // list arriving.
  const profile = touchedProfile ?? knownValue(PROFILES, project?.defaultProfile ?? null);

  // What this task would actually run on, which is the resolution the server
  // will do again: the override, else the project's column, else claude. Its
  // capabilities decide which controls beside it still mean anything — a
  // profile that takes no model gets the model chip disabled rather than a
  // value silently dropped at the spawn.
  //
  // Undefined while the list is loading, and undefined too for a name the list
  // does not hold (a project configured against a `profiles.json` since
  // edited). Both read as "no claim either way", so nothing is disabled: a
  // control greyed out on a guess is worse than one that lets the server give
  // the real answer.
  const effectiveProfile = profile || project?.defaultProfile || DEFAULT_PROFILE;
  const capabilities = profiles?.find((p) => p.name === effectiveProfile)?.capabilities;
  const takesModel = capabilities?.model ?? true;

  // A project with nowhere to make one. "General" is the case in practice: it
  // has no directory, so a task in it runs wherever the daemon does and there
  // is no repository to add a worktree to. Disabled rather than hidden, so the
  // row does not reflow as the project selection moves.
  const canWorktree = Boolean(project?.initialPath);

  // Attachments alone are enough. Dropping a screenshot in and pressing ⌘⏎ is
  // a complete ask — "look at this" — and the prompt it builds is the path,
  // which is what the agent needs anyway.
  const canSubmit = (prompt.trim().length > 0 || attachments.length > 0) && !submitting;

  const submit = useCallback(async () => {
    const typed = prompt.trim();
    // Nothing typed and nothing attached is not a task. The button is disabled
    // for it, and this guard is what makes the keystroke inert too.
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);

    // Before the create, because the prompt names the paths this answers with
    // and a task started on paths that were never written is worse than one
    // not started at all. A failure here leaves the prompt and the chips
    // exactly as they are, so the same ⌘⏎ retries the whole thing.
    let paths: string[] = [];
    if (attachments.length > 0) {
      try {
        paths = await uploadStaged(attachments.map((a) => a.file));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not upload the attachments");
        setSubmitting(false);
        return;
      }
    }
    const text = promptWithAttachments(typed, paths);

    // Only what the user actually overrode goes on the wire: an absent field
    // means "whatever the project says", and `createTask` on the server is
    // where that is resolved — so the API and the CLI get the same answer.
    const result = await createTask(
      {
        prompt: text,
        projectId: project?.id,
        model: model || undefined,
        // A name, never a command: the profile itself lives in the daemon's
        // configuration and only ever gets named over the wire (TASK-89).
        // Absent means the project's column, resolved on the server like the
        // model above.
        profile: profile || undefined,
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
  }, [
    prompt, canSubmit, createTask, project, model, profile, worktree, baseRef, canWorktree,
    attachments, openTask,
  ]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
      // Before the newline the textarea would otherwise insert.
      event.preventDefault();
      void submit();
    },
    [submit],
  );

  // A screenshot on the clipboard, which is the case attachments exist for:
  // ⌘⇧4 then ⌘V, with nothing saved to disk in between. `preventDefault` only
  // when there are files, because a paste carries both — copying an image out
  // of a browser puts its markup on the clipboard beside it — and swallowing
  // an ordinary text paste to catch the rare one is the worse trade.
  const handlePaste = useCallback(
    (event: ClipboardEvent<HTMLTextAreaElement>) => {
      const files = Array.from(event.clipboardData?.files ?? []);
      if (files.length === 0) return;
      event.preventDefault();
      addFiles(files);
    },
    [addFiles],
  );

  // Counted, not toggled: `dragenter` fires again for every child the pointer
  // crosses and `dragleave` fires for the one it left, so a boolean flickers
  // off as the drag moves over the textarea inside the drop zone. The count is
  // the state — the overlay is `dragDepth > 0` — so there is no second flag to
  // keep in step with it.
  //
  // Nothing is counted while the submit is in flight, because `addFiles` would
  // refuse the drop and an overlay saying "drop files to attach" over a drop
  // that is about to be ignored is the one lie worth avoiding.
  const handleDragEnter = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (submitting || !event.dataTransfer.types.includes("Files")) return;
      event.preventDefault();
      setDragDepth((d) => d + 1);
    },
    [submitting],
  );

  const handleDragLeave = useCallback(() => {
    // Unconditional, and floored rather than guarded: an "only if counted"
    // test on the rendered value would read stale between two drag events
    // that land before a commit — enter then leave on one swipe — and skip
    // the decrement, leaving the overlay up. A leave nothing counted (a text
    // drag) takes 0 to 0. There is no default to prevent on dragleave.
    setDragDepth((d) => Math.max(0, d - 1));
  }, []);

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (!event.dataTransfer.types.includes("Files")) return;
      // Without this the browser navigates the whole SPA to the dropped file,
      // taking the prompt with it.
      event.preventDefault();
      setDragDepth(0);
      addFiles(Array.from(event.dataTransfer.files));
    },
    [addFiles],
  );

  return (
    <div
      className="grid h-full place-items-center overflow-auto p-3 md:p-6"
      onDragEnter={handleDragEnter}
      // Every one of them: a `dragover` that is not prevented is the browser
      // declining the drop, and then `onDrop` never fires at all.
      onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) e.preventDefault(); }}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="relative flex w-full max-w-[720px] flex-col gap-2.5">
        <Textarea
          // Addressed by id, and focused on mount — on a desktop. Arriving at
          // `/` there means the user is about to type, so the caret is placed.
          //
          // On a phone it is not (TASK-79). `autoFocus` fires on *every* mount
          // of `/` — the initial load, the redirect from a dead task URL — and
          // each one pops the soft keyboard over a third of the viewport
          // before the user has asked to type. So the caret is placed only by
          // `useOpenComposer`, which focuses this box by its id on the
          // deliberate press, and which is what covers the case where `/` is
          // already showing and this never remounts.
          id={COMPOSER_PROMPT_ID}
          autoFocus={!isMobile}
          rows={5}
          value={prompt}
          placeholder="What should the agent do?"
          aria-label="Prompt"
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
        />
        <AttachmentStrip
          attachments={attachments}
          onRemove={removeAttachment}
          disabled={submitting}
        />
        <div className="flex flex-wrap items-center gap-1.5">
          <Select
            label="project"
            icon={Folder}
            options={projects.map((p) => ({ value: p.id, label: p.name }))}
            value={project?.id ?? ""}
            onValueChange={setProjectId}
          />
          {/* Before the model, because it decides whether the model means
              anything: the two read left to right as "run it on this, at that
              size". */}
          <Select
            label="agent"
            options={PROFILES}
            value={profile}
            onValueChange={setProfile}
          />
          <Select
            label="model"
            options={MODELS}
            value={model}
            // Disabled rather than hidden, so the row does not reflow as the
            // agent selection moves — the same bargain the worktree box
            // strikes for a project with nowhere to branch.
            disabled={!takesModel}
            title={
              takesModel
                ? undefined
                : "This agent takes no model"
            }
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
          {/* Last of the option chips, and first of the things that are about
              the prompt rather than about the task's settings — the strip it
              fills sits directly above it. */}
          <Button
            variant="outline"
            icon={Paperclip}
            aria-label="Attach files"
            title="Attach files or images"
            // Off once the submit is under way: the file list was snapshotted
            // before the upload, so anything picked now would go nowhere.
            disabled={submitting}
            onClick={() => fileInputRef.current?.click()}
          >
            Attach
          </Button>
          {/* Hidden, and driven by the button above: a bare file input cannot
              be styled into the chip row, and `capture`-less `accept` would
              only narrow what the user is allowed to attach. `value` is
              cleared on every change so re-picking the same file fires one.
              No name of its own: `display: none` keeps it out of the a11y tree
              entirely, and the button above is what carries the label. */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              addFiles(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
          <div className="ml-auto flex items-center gap-2">
            {error ? (
              <span role="alert" className="text-xs text-destructive">
                {error}
              </span>
            ) : null}
            {/* Hidden on a touch keyboard: a chord hint there describes keys
                that are not on it. On a pointer-coarse device the button
                beside it is the whole story. */}
            <KeyHint keys={["⌘", "⏎"]} className="pointer-coarse:hidden" />
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
        {dragOver ? (
          // `pointer-events-none`, so the overlay cannot become the drop
          // target itself and take the `dragleave` that closes it.
          <div
            className={cn(
              "pointer-events-none absolute inset-0 z-10 grid place-items-center",
              "rounded-md border border-dashed border-ring bg-pane/90",
              "text-sm text-muted-foreground",
            )}
          >
            <span className="flex items-center gap-2">
              <Upload size={14} />
              Drop files to attach
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
