// The composer's one draft (TASK-112).
//
// `Composer` is unmounted the moment the route leaves `/`, and until this
// store existed every field it holds was `useState` inside it: type half a
// prompt, click a task in the sidebar to check something, come back, and the
// prompt was gone — with the attachments and every chip the user had moved.
// There was one copy and it died with the component.
//
// So the draft lives here, in a module binding the component reads through
// `useSyncExternalStore`, and leaving `/` is simply leaving: the header's `+`
// and any other arrival at `/` land on the draft exactly as it was. There is
// one draft, not one per project, because the composer is one pane — a user
// who pressed web's `+` while drafting for general wanted the draft *moved*,
// which is what the press does.
//
// **In memory only.** A `File` and the object URL minted for its thumbnail
// cannot go to `localStorage`, and the defect was losing the draft within a
// session; a reload starting fresh is the same as it always was. Persisting
// the prompt text alone would be a follow-up, and a separate decision.
//
// **The option chips are overrides, not values.** `model`, `profile`,
// `worktree` and `baseRef` are `null` until the user touches them, and the
// composer derives what each chip shows from the selected project's own
// columns when they are. That is what makes "changing project re-seeds the
// chips" a matter of clearing four fields in `setComposerDraftProject`, with
// no record of which project they were seeded from and nothing to re-run when
// the project list lands late over the socket. The submit sends only what is
// non-null and differs from the project's answer, as it always did.
//
// **The address.** `?project=` is a preference the URL carries: it seeds the
// selection on arrival so a copied link opens on that project, and it is never
// written back. `urlProject` is the last value of it this draft applied, so a
// *remount* at the same address — Back to `/?project=web` after a detour
// through a task — re-applies nothing and the chips the user moved survive,
// while a *change* of it (Back or Forward across the entries each `+` pushed,
// or a copied link on a fresh draft) still moves the selection. It is recorded
// only where the address is actually applied, never where a navigation is
// merely begun: a `+` press moves the project and nothing else, and the
// arrival that follows finds the project already there and moves nothing
// again. That is also what makes a second press of the same project's `+`
// land when the chip was moved by hand since (TASK-82): the press writes the
// project, and the URL not changing is beside the point.
//
// **A move is a change.** Selecting the project already selected — by hand,
// by `+`, or by an address naming it after a detour through a plain `/` — is
// not a move, and clears no override. The chips are re-seeded when the project
// the user is looking at is a different one, which is the only time the old
// answers were about something else.
//
// **The submit in flight is the draft's, not the component's.** A submit
// awaits an upload and then a create, and the composer can be unmounted and
// mounted again in the meantime. Held here, the second mount finds the draft
// locked — the button disabled, files refused — instead of the same prompt
// and attachments ready to be sent a second time.

import { releaseAttachment, toAttachment, type Attachment } from "@/frontend/lib/attachments";

export interface ComposerDraft {
  prompt: string;
  /** The selected project, or `""` before anything chose one — which the
   * composer resolves to the first project in the list, as it does for an id
   * naming a project that no longer exists. */
  projectId: string;
  /** Overrides. `null` is "untouched": the chip shows the project's own
   * column, and nothing about it goes on the wire. */
  model: string | null;
  profile: string | null;
  worktree: boolean | null;
  baseRef: string | null;
  /** Held until submit (TASK-93). Each may own an object URL, released when
   * it leaves the draft and nowhere else — not on unmount, since the draft
   * outlives the component now. */
  attachments: Attachment[];
  /** The last `?project=` this draft applied (`null` for none), so a remount
   * at the same address does not apply it twice. */
  urlProject: string | null;
  /** A submit is under way: the upload, then the create. Nothing may be
   * added or sent until it settles, whichever mount is showing. */
  submitting: boolean;
}

/** Overrides cleared, prompt empty, nothing attached, nothing in flight. */
const UNTOUCHED = {
  prompt: "",
  model: null,
  profile: null,
  worktree: null,
  baseRef: null,
  attachments: [] as Attachment[],
  submitting: false,
} satisfies Partial<ComposerDraft>;

/** The four chip overrides, back to untouched. */
const RESEEDED = { model: null, profile: null, worktree: null, baseRef: null } as const;

export const EMPTY_DRAFT: ComposerDraft = { ...UNTOUCHED, projectId: "", urlProject: null };

let current: ComposerDraft = EMPTY_DRAFT;

type Listener = () => void;

const listeners = new Set<Listener>();

function notify(): void {
  // Copied: a listener may unsubscribe (the composer unmounting) mid-walk.
  for (const listener of [...listeners]) listener();
}

/** The snapshot `useSyncExternalStore` compares by identity: replaced on every
 * write and never mutated, so a re-render on its own is not a change. */
export function getComposerDraft(): ComposerDraft {
  return current;
}

export function subscribeComposerDraft(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Merge a patch in. Against the store and never against a value a render
 * closed over, so two writes from one event do not each spread the same
 * pre-event draft and the second undo the first. */
export function patchComposerDraft(patch: Partial<ComposerDraft>): ComposerDraft {
  current = { ...current, ...patch };
  notify();
  return current;
}

/** What moving to `projectId` changes: nothing when it is the project already
 * selected, else the selection and the four option overrides back to
 * untouched — they were answers about the project being left, and the one
 * arrived at has columns of its own for the chips to show. The prompt and the
 * attachments are the user's and are never in here. */
function moveTo(projectId: string): Partial<ComposerDraft> {
  return projectId === current.projectId ? {} : { projectId, ...RESEEDED };
}

/** Move the selection, by hand or by request. A no-op, with no write and no
 * notify, for the project already selected. */
export function setComposerDraftProject(projectId: string): ComposerDraft {
  const patch = moveTo(projectId);
  return "projectId" in patch ? patchComposerDraft(patch) : current;
}

/** A project group's `+` (TASK-77): move the selection, whatever the chip
 * currently says and whether or not the composer is mounted. The `?project=`
 * the caller then navigates to is recorded by the arrival, not here — a
 * navigation can be refused, and an address recorded as applied that never
 * showed would swallow the next genuine arrival at it. */
export function requestComposerProject(projectId: string): ComposerDraft {
  return setComposerDraftProject(projectId);
}

/** The `?project=` the composer is currently mounted under. Applied only when
 * it differs from the last one applied — a remount at the same address is not
 * a new ask — and moves the chip only when it names something: Back to a
 * plain `/` is the address dropping its preference, not an instruction to
 * move anywhere. One write, so no snapshot has the address ahead of the
 * project. */
export function applyComposerUrlProject(param: string | undefined): void {
  const next = param ?? null;
  if (next === current.urlProject) return;
  patchComposerDraft({ ...(next ? moveTo(next) : {}), urlProject: next });
}

/** Lock or release the draft around a submit. */
export function setComposerSubmitting(submitting: boolean): void {
  if (submitting !== current.submitting) patchComposerDraft({ submitting });
}

/** Refused while a submit is in flight: it snapshotted the attachments before
 * awaiting the upload, so a file added now would be uploaded by nobody and
 * named in no prompt — silently dropped. */
export function addComposerAttachments(files: File[]): ComposerDraft {
  if (current.submitting || files.length === 0) return current;
  return patchComposerDraft({ attachments: [...current.attachments, ...files.map(toAttachment)] });
}

/** Released here, the one place an attachment leaves the draft short of the
 * whole draft going. */
export function removeComposerAttachment(id: string): ComposerDraft {
  const going = current.attachments.find((a) => a.id === id);
  if (!going) return current;
  releaseAttachment(going);
  return patchComposerDraft({ attachments: current.attachments.filter((a) => a.id !== id) });
}

/** After a successful submit. Everything typed, attached and overridden goes,
 * and the lock with it; the project stays, because the next task is more
 * often than not in the same one, and `urlProject` stays with it so the
 * address the composer was under is not re-applied over that choice on the
 * next arrival. */
export function clearComposerDraft(): ComposerDraft {
  current.attachments.forEach(releaseAttachment);
  return patchComposerDraft({ ...UNTOUCHED });
}

/** Module state outlives a test, and a draft carried into the next one is a
 * prompt nobody typed. Releases what the last test attached, since nothing
 * else will. Silent, like the other stores' resets: every caller resets in a
 * `beforeEach`, before anything is rendered. */
export function resetComposerDraft(): void {
  current.attachments.forEach(releaseAttachment);
  current = EMPTY_DRAFT;
}
