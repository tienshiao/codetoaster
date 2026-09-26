import {
  useCallback,
  useLayoutEffect,
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
  addComposerAttachments,
  applyComposerUrlProject,
  clearComposerDraft,
  getComposerDraft,
  patchComposerDraft,
  removeComposerAttachment,
  setComposerDraftProject,
  setComposerSubmitting,
  subscribeComposerDraft,
} from "@/frontend/composer-draft-store";
import { useIsMobile } from "@/frontend/hooks/use-mobile";
import { uploadStaged } from "@/frontend/lib/upload-api";
import { useProfiles } from "@/frontend/hooks/use-profiles";
import { useComposerProject } from "@/frontend/hooks/use-composer-project";
import { COMPOSER_PROMPT_ID, useOpenTask } from "@/frontend/hooks/use-task-nav";
import { AttachmentStrip } from "@/frontend/components/AttachmentStrip";
import { promptWithAttachments } from "@/frontend/lib/attachments";
import { MentionSuggestions, useMention } from "@/frontend/components/MentionSuggestions";
import { cn } from "@/frontend/lib/utils";
import { Button } from "@/frontend/components/v2/Button";
import { Checkbox } from "@/frontend/components/v2/Checkbox";
import { KeyHint } from "@/frontend/components/v2/KeyHint";
import { Select } from "@/frontend/components/v2/Select";
import {
  knownValue,
  modelOptions,
  profileOptions,
} from "@/frontend/lib/agent-options";
// From `profile.ts`, which imports nothing, and not from the registry beside
// it, which reads the daemon's configuration off disk.
import { DEFAULT_PROFILE } from "@/lib/agent/profile";
import { TextInput } from "@/frontend/components/v2/TextInput";
import { Textarea } from "@/frontend/components/v2/Textarea";
import { moveLayout } from "@/frontend/layout-store";
import { projectRoot, rootId } from "@/frontend/repo-root";

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
 * Project sits above the prompt, and the rest — agent, model, worktree, base
 * ref — in the row below it: everything a task is decided by before it starts,
 * with the one that is decided first read first. Each sends nothing when it
 * matches the project's own answer, because the server resolves an absent
 * field against the project's columns and that is what gives the HTTP API and
 * the CLI the same behaviour for free (§7.5).
 *
 * Permission mode is not among them, and deliberately: the row offered a
 * `--permission-mode` picker that Claude Code is better placed to answer than
 * a chip on a form, so nothing here sets one and the agent keeps its own
 * default. The column, the `POST /api/tasks` field and the server's resolution
 * of them all survive — a mode set by the API or the CLI still spawns with it.
 *
 * What the user has typed, attached and chosen is not this component's: it
 * is the one draft in `composer-draft-store`, read through
 * `useSyncExternalStore` and written through the store's own functions. The
 * composer is unmounted the moment the route leaves `/`, and a draft held in
 * its state died with it — half a prompt, the screenshots pasted under it and
 * every chip moved, all gone because the user clicked a task to check
 * something. Held in the store, leaving `/` is only leaving, and the header's
 * `+` comes back to the draft exactly as it was (TASK-112). It is in memory
 * only; an attached `File` cannot be persisted, so a reload starts fresh.
 *
 * `projectId` is `/?project=<id>`, and it is a preference and not an address:
 * it seeds the selection so a copied URL opens on the project it names, an id
 * that names no project falls through the same fallback a deleted project's id
 * does and the composer opens on the first one, and the selection is never
 * written back to it. It is handed to the store on every change, and the
 * store applies it only when it differs from the last one it applied. That is
 * what lets Back and Forward across the entries each `+` pushed still move the
 * selection, while a remount at the same address — Back to `/?project=web`
 * after a detour through a task — re-applies nothing over a chip the user
 * moved by hand in between.
 *
 * A project group's `+` does not go through the prop at all. It writes the
 * store directly, moving the draft's project whether or not this is mounted;
 * the arrival that follows finds the project already there and moves nothing
 * again. A second press of the project already named is therefore a real
 * move even though its navigation goes to the address already showing
 * (TASK-82). Whichever way the ask arrives, only the project moves: the prompt
 * and the attachments are the user's.
 *
 * The option chips are overrides, `null` until touched, and what each shows is
 * derived every render against the selected project's own columns. Moving to
 * a different project re-seeds them by clearing the overrides in the store, so
 * there is no record of which project they were seeded from and nothing to
 * re-run when the project list lands late over the socket. Being asked for
 * the project already selected — by hand, by `+`, or by an address naming it
 * after a detour through a plain `/` — is not a move and clears nothing.
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

  const draft = useSyncExternalStore(subscribeComposerDraft, getComposerDraft, getComposerDraft);
  // In the draft and not here, because the submit outlives this: it awaits an
  // upload and a create, and a composer mounted again in the meantime must
  // find the draft locked rather than the same prompt ready to send twice.
  const submitting = draft.submitting;
  // The message is not: it belongs under the control that failed, on the
  // mount that pressed ⌘⏎, and a failure that lands after the user has left
  // has the intact draft to show for itself when they come back.
  const [error, setError] = useState<string | null>(null);

  // The address, handed to the store, which moves the selection only when it
  // differs from the last one applied. A layout effect and not a plain one:
  // the store's notify re-renders this synchronously inside the commit, so the
  // moved project lands before the browser paints — a passive effect would
  // paint a frame of the previous project and its chips first, and ⌘⏎ in that
  // frame would send them.
  useLayoutEffect(() => {
    applyComposerUrlProject(requestedProjectId);
  }, [requestedProjectId]);

  // Files are held in the draft until submit (TASK-93). Nothing is written to
  // disk while they sit there, so a draft the user walks away from leaves no
  // orphans behind and there is no cleanup pass to own; the cost is that a
  // large paste is uploaded at ⌘⏎ rather than in the background before it.
  // Their object URLs are released by the store when they leave the draft and
  // not on unmount, since the draft outlives this.
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Nested drag targets fire `dragleave` on the way *in* to a child, so the
  // overlay has to count enters rather than trust the last event — the same
  // arrangement the terminal's drop target uses.
  const [dragDepth, setDragDepth] = useState(0);
  const dragOver = dragDepth > 0;

  // The store refuses files while a submit is in flight, and it holds the
  // flag, so the guard is there and not here.
  const addFiles = addComposerAttachments;

  const setPrompt = useCallback((value: string) => patchComposerDraft({ prompt: value }), []);

  // The list arrives over the socket, so there is a first render with no
  // projects at all and the selection has to survive it: an id held from before
  // a project was deleted elsewhere is no longer a choice either — and neither
  // is a `?project=` naming one that never existed, which lands here too.
  const project = useComposerProject();

  // Written back when the two differ, which is the draft naming nothing yet or
  // naming a project that is gone. Recorded as a move so the overrides set
  // against the project that was deleted — a base ref that only it had — are
  // not sent for the one standing in for it. Read from the store and not from
  // this render's snapshot: the address effect above may just have moved the
  // project in the same commit, and a settle against the snapshot would move
  // it back. A layout effect for the reason the address effect is one.
  useLayoutEffect(() => {
    const live = getComposerDraft();
    const resolved = projects.find((p) => p.id === live.projectId) ?? projects[0];
    if (resolved) setComposerDraftProject(resolved.id);
  }, [projects, draft.projectId]);

  // Each chip is the user's override if there is one, else the selected
  // project's own answer. Derived every render rather than seeded when the
  // selection moves, so the frame where the list first lands and picks the
  // first project is already right, and moving the project is only a matter of
  // the store clearing the overrides.
  const model = draft.model ?? knownValue(MODELS, project?.defaultModel ?? null);
  // Derived against the fetched list as well as the project, because its
  // options arrive over the network: `knownValue` against a list that has not
  // landed answers "unset" for every project, so a value stored when the
  // selection moved would show "Project default" over a project that has one —
  // and would never correct itself, since the selection is not what changed
  // when the answer came back. Read every render, it simply becomes right.
  //
  // `null` is "the user has not touched this", which is not the empty choice:
  // that is a deliberate "let the project decide", and it has to survive the
  // list arriving.
  const profile = draft.profile ?? knownValue(PROFILES, project?.defaultProfile ?? null);
  const worktree = draft.worktree ?? project?.worktreeDefault ?? false;
  const baseRef = draft.baseRef ?? project?.defaultBaseRef ?? "";
  const { prompt, attachments } = draft;

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

  // `@` completion over the prompt (TASK-100). The project is handed over only
  // when it has a directory, which is what makes a relative query in "General"
  // ask nothing and show nothing — an absolute one still completes, since the
  // filesystem is there either way.
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const mention = useMention({
    value: prompt,
    onValue: setPrompt,
    textarea: promptRef,
    projectId: project?.initialPath ? project.id : undefined,
  });

  // Nothing typed is still a task (TASK-107): the project, agent and worktree
  // are chosen here, and the conversation starts in the agent's terminal. What
  // it needs is a project — absent only before the list lands, when ⌘⏎ would
  // otherwise send no project at all.
  const canSubmit = project != null && !submitting;

  const submit = useCallback(async () => {
    const typed = prompt.trim();
    // The button is disabled for it, and this guard is what makes the
    // keystroke inert too.
    if (!canSubmit) return;
    setComposerSubmitting(true);
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
        setComposerSubmitting(false);
        return;
      }
    }
    const text = promptWithAttachments(typed, paths);

    // Only what the user actually overrode goes on the wire: an absent field
    // means "whatever the project says", and `createTask` on the server is
    // where that is resolved — so the API and the CLI get the same answer.
    const result = await createTask(
      {
        // Absent, not blank, when there is nothing to ask: the server refuses a
        // blank prompt and reads an absent one as a task started without one.
        prompt: text || undefined,
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
      setComposerSubmitting(false);
      return;
    }
    // The draft is spent, and goes: prompt, attachments (their object URLs
    // released), overrides and the lock. The project stays, since the next
    // task is more often than not in the same one. The lock cannot be left on
    // — the next mount at `/` would inherit it — so between here and the
    // navigation unmounting this, an empty draft is briefly sendable. That is
    // a keystroke landing inside one microtask, and it would start a
    // promptless task on the same project, which is a thing the button offers
    // anyway.
    clearComposerDraft();
    // The tabs opened from the project's Explorer while this prompt was being
    // written become the task's (TASK-106), and the project's composer starts
    // fresh for the next one. The `?tab=agent` below then brings the agent to
    // the front of the moved layout. Only the layout moves: the view-state
    // slots (scroll offsets, toggles) stay keyed by the project root and are
    // not carried over. And a `diff` tab moved into a worktree task reads "No
    // longer in the working-tree diff" until the agent touches that file —
    // the new checkout has not changed it, which is the honest answer.
    if (project) moveLayout(rootId(projectRoot(project.id)), result.value.id);
    openTask(result.value.id, { tab: "agent" });
  }, [
    prompt, canSubmit, createTask, project, model, profile, worktree, baseRef, canWorktree,
    attachments, openTask,
  ]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      // The suggestion list first, and only while it has rows on screen: it
      // owns the arrows, plain Enter and Tab, and deliberately never takes ⌘⏎ —
      // so submitting is the same keystroke whether or not it is open.
      if (mention.onKeyDown(event)) return;
      if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
      // Before the newline the textarea would otherwise insert.
      event.preventDefault();
      void submit();
    },
    [mention, submit],
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
        {/* Above the prompt, and alone: the project is chosen before anything
            is typed, so it comes first in reading order and first in tab
            order. The rest of the options are decisions about a prompt that
            already exists, and sit under it. */}
        <div className="flex items-center gap-1.5">
          <Select
            label="project"
            icon={Folder}
            options={projects.map((p) => ({ value: p.id, label: p.name }))}
            value={project?.id ?? ""}
            onValueChange={setComposerDraftProject}
          />
        </div>
        {/* The positioning context for the suggestion list, which hangs off the
            bottom edge of the field rather than following the caret: the prompt
            is prose, and a popover moving with every keystroke inside it is
            harder to read than one that stays put. */}
        <div className="relative">
          <Textarea
            ref={promptRef}
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
            // The composer's own `setPrompt`, through the completion: the mention
            // is read off this event and nothing else, so clicking into an
            // existing `@path` opens nothing while typing inside one re-queries.
            onChange={mention.onChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onBlur={mention.onBlur}
            aria-autocomplete="list"
            // Only while the list exists: an id that points at nothing is what
            // assistive tech reads as a broken relationship.
            aria-controls={mention.open ? mention.listId : undefined}
            aria-expanded={mention.open}
            aria-activedescendant={mention.activeId}
          />
          {mention.open ? (
            <MentionSuggestions
              id={mention.listId}
              rows={mention.rows}
              index={mention.index}
              onHighlight={mention.setIndex}
              onAccept={mention.accept}
            />
          ) : null}
        </div>
        <AttachmentStrip
          attachments={attachments}
          onRemove={removeComposerAttachment}
          disabled={submitting}
        />
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Before the model, because it decides whether the model means
              anything: the two read left to right as "run it on this, at that
              size". */}
          <Select
            label="agent"
            options={PROFILES}
            value={profile}
            onValueChange={(v) => patchComposerDraft({ profile: v })}
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
            onValueChange={(v) => patchComposerDraft({ model: v })}
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
            onChange={(e) => patchComposerDraft({ worktree: e.target.checked })}
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
                onChange={(e) => patchComposerDraft({ baseRef: e.target.value })}
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
