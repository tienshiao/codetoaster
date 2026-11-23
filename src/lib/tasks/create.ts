import * as fs from "fs";
import { profileCapabilities } from "../agent/profile";
import { DEFAULT_PROFILE } from "../agent/profiles";
import { writeTaskSettings } from "../agent/settings";
import { buildAgentCommand, taskDir, taskEnv } from "../agent/spawn";
import type { TaskRow } from "../db";
import { expandTilde } from "../tilde";
import {
  createWorktree,
  removeWorktree,
  setupStampPath,
  wrapWithSetup,
  WorktreeError,
  type CreatedWorktree,
} from "../worktree";
import { uniqueName } from "../xtmux/naming";
import type { Pty } from "../xtmux/pty";
import { deriveTitle, resolveRepoRoot, titleFromPrompt } from "./derive";
import type { TaskHost } from "./host";
import type { CreateTaskOptions } from "./manager";

/** Creating a task: its checkout, its row, its settings file and its first
 * terminal, with each step taken back if a later one fails. Split out of
 * TaskManager (TASK-152). */
export class TaskCreation {
  constructor(private readonly host: TaskHost) {}

  async createTask(options: CreateTaskOptions): Promise<TaskRow> {
    const { id } = options;
    if (this.host.store.get(id)) {
      throw new Error(`Task "${id}" already exists`);
    }

    // Resolved before anything reads it, rather than at the row. The worktree
    // path is keyed on the project's id and its base ref comes off the
    // project's column, so both are needed while there is still no row — and
    // `resolveProjectId` keys off `afterTaskId` still being in some project's
    // `taskIds`, which a delete landing mid-create would change under us.
    const projectId = this.host.resolveProjectId(options);
    const project = this.host.projects.find((p) => p.id === projectId);

    // Before the worktree, the row and the settings file — before anything this
    // create would have to undo. An unknown profile is a name the caller typed,
    // and the cheapest possible failure for it is one with nothing behind it
    // yet: no checkout added, no branch named, no row holding an id that can
    // never be issued again.
    //
    // Three rungs, the same shape and for the same reason as the model below:
    // what the request named, else what the project it *joins* decided, else
    // `claude`. Read off `project` and not off `options.projectId`, so a create
    // that names no project — the API and CLI shape — still inherits from the
    // project it lands in (TASK-89.3).
    const profile = this.host.profiles.require(
      options.profile ?? project?.defaultProfile ?? DEFAULT_PROFILE,
    );
    const capabilities = profileCapabilities(profile);

    // Inherit cwd from afterTaskId's terminal, or from the project's initialPath
    let cwd: string | undefined;
    if (options.afterTaskId) {
      // The live terminal first — it knows where the agent actually is — but a
      // task with no process still has a directory on its row, and inheriting
      // that beats silently falling back to the daemon's own cwd.
      cwd = (await this.host.primaryPty(options.afterTaskId)?.getCwd())
        ?? this.host.store.get(options.afterTaskId)?.cwd;
    }
    if (!cwd && options.projectId && project?.initialPath) {
      cwd = expandTilde(project.initialPath);
    }
    // Spelled out rather than left undefined: the PTY inherits this directory
    // either way, but a derived title can only describe a cwd it knows.
    if (!cwd) cwd = process.cwd();

    // Three sources, in order of how much they know about what this task is
    // *for* (§7.5). A caller-supplied title is a deliberate choice and outranks
    // everything, including the terminal title, for good. Failing that the
    // opening line of the prompt, which is nearly always the ask — and which is
    // the whole reason a list of thirty tasks in one checkout is readable.
    // Failing that the "<dir> · <branch>" label, which at least says where.
    //
    // Only the first is `manual`. The other two are guesses, and a live
    // terminal title — the agent's own account of what it is doing — is
    // allowed to display over either (naming.ts).
    //
    // `||`, not `??`: an empty title is no title at all, and `title_source`
    // below judges it on truthiness — the two must not disagree, or a task
    // ends up labelled "" and recorded as having derived that.
    //
    // One expression, so each `||` still short-circuits the one after it:
    // `deriveTitle` shells out to git (two calls on a detached HEAD, 2s of
    // timeout budget), and a create that already knows its title — or can read
    // one off the prompt — must not block on a lookup whose answer it throws
    // away. Hoisting the derived label to its own `const` is what would cost
    // that.
    const title = options.title
      || uniqueName(titleFromPrompt(options.prompt) || (await deriveTitle(cwd)), this.host.taskTitles());

    // The checkout, if this task is getting one (§5.6) — and before the row,
    // which is what makes a failed create leave nothing behind. `createWorktree`
    // already backs its own partial state out, so a throw here means no
    // directory, no branch, and now no row either.
    //
    // After the title, because the branch is named from it, and the title is
    // derived against the *project's* checkout rather than the worktree that
    // does not exist yet. That is the honest reading anyway: the fallback
    // label is "<dir> · <branch>", and the directory a task was started from
    // is what it describes. A task with a prompt takes `titleFromPrompt`
    // regardless; one started from the composer with none (TASK-107) keeps
    // this label, and its branch is named from it.
    let worktree: CreatedWorktree | undefined;
    // Resolved once and reused by the row below, so what the checkout was
    // branched from and what `base_ref` records cannot disagree.
    let baseRef: string | undefined;
    // Kept for the rollback: the two failure paths below have to undo the
    // checkout, and they need the same directory `createWorktree` was given.
    let projectPath: string | undefined;
    if (options.worktree ?? project?.worktreeDefault ?? false) {
      if (!project?.initialPath) {
        // A `WorktreeError`, and `not-a-repo` specifically, because the route
        // grades the failure off the kind and this one is the caller's: the
        // composer disables the toggle for a project with no directory, so
        // only the HTTP API and the CLI can ask for this, and answering them
        // with a 500 tells them to retry something that will never work.
        throw new WorktreeError(
          "not-a-repo",
          `Project "${project?.name ?? projectId}" has no directory to add a worktree to`,
        );
      }
      projectPath = expandTilde(project.initialPath);
      baseRef = options.baseRef ?? project.defaultBaseRef ?? "HEAD";
      worktree = await createWorktree(
        { id: projectId, initial_path: projectPath, worktree_copy: project.worktreeCopy },
        { id, title },
        baseRef,
      );
      // The whole point: the agent runs *in* its checkout, so everything that
      // reads the task's directory — the git routes, the file tree, the next
      // resume — lands there rather than in the project's own tree. The
      // checkout's *cwd*, not its root: a project pointing at `repo/frontend`
      // gets `<worktree>/frontend`, which is the directory the user chose
      // (TASK-65).
      cwd = worktree.cwd;
    }

    // Guarded like the two steps after it, and for the same reason: from the
    // moment `createWorktree` returns, *everything* left in this function has
    // to take the checkout with it if it throws. The insert is the one step
    // that is easy to read as infallible and is not — a constraint, a locked
    // or full database — and a throw here would leave a registered worktree
    // and a branch named off the title behind for a task that never existed.
    let row: TaskRow;
    try {
      row = this.host.store.create({
        id,
        project_id: projectId,
        // Allocated here, before anything starts: passing `--session-id` is how
        // we know what to resume without asking the agent afterwards (§4.1).
        // A used id cannot be reused, so this is minted per task and only ever
        // replaced — by a `/clear` reported through SessionStart (TASK-11), or
        // by a start-fresh fallback (TASK-13).
        agent_session_id: crypto.randomUUID(),
        // What every spawn for this task renders its argv through, now and at a
        // resume months from now — which is why it is stored rather than
        // re-resolved from the project each time (TASK-89).
        agent_profile: profile.name,
        title,
        title_source: options.title ? "manual" : "derived",
        // Trimmed, because `buildAgentCommand` judges this on truthiness and
        // `titleFromPrompt` above judges it on having a non-blank line: the two
        // must agree, or a whitespace-only prompt gets the directory label as
        // though it said nothing while still travelling in argv to submit a blank
        // opening turn. `POST /api/tasks` refuses a blank prompt outright, so
        // this is what keeps the invariant true for a caller reaching the manager
        // directly rather than a second line of defence against the route.
        initial_prompt: options.prompt?.trim() ?? "",
        // Resolved once and stored, so the data routes never have to ask a
        // process where they are (§5.4). `undefined` (the lookup never ran) is
        // recorded as "no repository" here, since there is no earlier value to
        // keep — refreshCwd is where the distinction matters.
        repo_root: (await resolveRepoRoot(cwd)) ?? null,
        cwd,
        // The project's column is what an absent option means. The composer
        // sends only what the user actually overrode — "Project default" is no
        // field at all — so resolving here rather than in the client is what
        // gives the API and the CLI the same answer for free.
        //
        // Read off `projectId`, the project the task actually joins, and not off
        // `options.projectId`, the one the caller happened to name. A create that
        // names no project still lands in "general", so keying this off the
        // option meant `POST /api/tasks {prompt}` — the API and CLI shape, the
        // very callers this is resolved server-side for — inherited nothing at
        // all while the row sat in a project with defaults set.
        model: options.model ?? project?.defaultModel ?? null,
        permission_mode: options.permissionMode ?? project?.defaultPermissionMode ?? null,
        // What the task owns in git, and what boot reconciliation (TASK-32) and
        // the evict tier (TASK-39) read to know there is anything to reconcile.
        // `worktree_state` stays "none" for a task running in the project's own
        // checkout, which is the difference between "we made this" and "we found
        // the user already working here".
        ...(worktree
          ? {
              worktree_path: worktree.worktreePath,
              // The task's own handle on its repository, so nothing downstream
              // has to ask the project where the checkout lives — a project the
              // task may outlive (TASK-64).
              worktree_repo: worktree.repoRoot,
              // And where in it the task works, so a restore can put the agent
              // back in the same directory without asking a project that may be
              // gone or repointed by then (TASK-65).
              worktree_subdir: worktree.subdir,
              branch: worktree.branch,
              base_ref: baseRef,
              worktree_state: "present" as const,
            }
          : {}),
      });
    } catch (e) {
      await this.undoWorktree(worktree, projectPath);
      throw e;
    }

    // The row is only worth keeping if something is running behind it: Bun.spawn
    // throws outright when the command is missing from PATH, and a row left
    // over from that is in no project, absent from every list, and blocks its
    // own id from ever being used again.
    // Before the spawn, because `--settings` names it: the agent reads the file
    // at startup, and a task whose hooks were written afterwards would run its
    // first session reporting nothing (§4.2). Skipped when the caller brought
    // its own command — a plain shell has no hooks to install — and skipped for
    // a profile whose templates never name `{settings}`, which has nowhere to
    // point at the file: writing one anyway would be a directory per task that
    // nothing will ever read, and the task lives in TASK-12's degraded mode
    // either way.
    let settingsPath: string | undefined;
    if (!options.command && capabilities.hooks) {
      try {
        settingsPath = await writeTaskSettings(id);
      } catch (e) {
        this.host.store.delete(id);
        // Bun.write creates the task directory before it writes the file, so a
        // failure part-way through leaves one behind exactly as a failed spawn
        // does — and with the row gone, nothing will ever read it again.
        fs.rmSync(taskDir(id), { recursive: true, force: true });
        await this.undoWorktree(worktree, projectPath);
        throw e;
      }
    }

    // Setup runs in the agent's own terminal, not before it (§5.6), and only
    // for a checkout this create just made: a task running in the project's
    // own tree is in a directory the user already set up, and re-running
    // `bun install` over it would be presumptuous at best. `options.command`
    // is left alone for the same reason it skips the settings write — a shell
    // tab is not the agent.
    const command = options.command
      ?? wrapWithSetup(
        buildAgentCommand(row, { settingsPath, profile, cwd }),
        worktree ? project?.setupCommand : null,
        setupStampPath(id),
      );

    let pty: Pty;
    try {
      pty = this.host.spawnPty(command, {
        id: options.ptyId,
        cols: options.cols,
        rows: options.rows,
        cwd,
        // Every PTY of a task, not just the agent's: an extra shell tab
        // (TASK-27) wants the same task id to report under, and the same
        // scrub — a shell that ran `claude` by hand would otherwise hit the
        // inherited-marker problem the scrub exists for.
        env: taskEnv(process.env, { taskId: id, port: this.host.port, origin: this.host.origin }),
      });
    } catch (e) {
      this.host.store.delete(id);
      // The settings we just wrote go with the row. Nothing will ever read
      // that directory again — its task does not exist, and its id can never
      // be issued a second time — so leaving it behind leaks a directory per
      // failed create.
      if (settingsPath) fs.rmSync(taskDir(id), { recursive: true, force: true });
      await this.undoWorktree(worktree, projectPath);
      throw e;
    }
    this.host.setSpawnedAt(id, Date.now());
    this.host.adopt(pty, id);
    // The task starting, so this is where its rank is stamped (TASK-116) —
    // not at row creation, which can precede the spawn by a worktree setup's
    // worth of minutes. Not in `adopt`, which a resume rung that fails passes
    // through too; the resume ladder stamps on the rung that works.
    this.host.stampRank(id, Date.now());
    // A fresh process on a fresh id: nothing about it is a restart, and an
    // entry left by a task that held this id before it would say otherwise.
    this.host.clearRestarted(id);
    // The clock only makes sense for a profile that can send a hook (TASK-89.4).
    // A hookless one never will, so the grace would do nothing but relabel a
    // perfectly healthy task `unknown` the moment it elapsed. Without it the
    // task's honest states are `starting`, then busy/idle as `inferState` reads
    // them off the terminal from the first byte of output, then `exited` —
    // TASK-12's degraded mode, which is what a profile with no `{settings}` was
    // always going to live in.
    if (capabilities.hooks) this.host.armHookGrace(id);
    this.host.placeInProject(id, projectId, options);
    // A new checkout is clean and its branch is at the base ref, so this
    // measures almost nothing — except the branch name, which is the one fact
    // the card can show before the agent has done anything at all. Not awaited:
    // the caller is a create that has already spawned an agent, and it must not
    // wait on git to answer.
    if (worktree) void this.host.refreshWorktreeStatus(id, { force: true });
    return row;
  }

  /** Take back a checkout this create made, for a create that failed after it.
   *
   * `createWorktree` backs its own partial state out, but the create keeps
   * going afterwards — the settings file, the spawn — and both of those throw
   * on things the user does hit: a `$SHELL` or an agent binary that is no
   * longer on PATH. Without this, that leaves a checkout and a branch on disk
   * for a task whose row was just deleted, and no code path will ever look at
   * them again. The branch is the worse half: it is named from the title, so
   * the next attempt at the same task would silently get a `-2`.
   *
   * Best effort. The create is already failing and the caller is owed the
   * original reason for that, not a cleanup error on top of it. */
  private async undoWorktree(
    worktree: CreatedWorktree | undefined,
    projectPath: string | undefined,
  ): Promise<void> {
    if (!worktree || !projectPath) return;
    await removeWorktree(projectPath, worktree.worktreePath, worktree.branch).catch(() => {});
  }
}
