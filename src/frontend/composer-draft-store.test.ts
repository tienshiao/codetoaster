import { test, expect, beforeEach, afterEach } from "bun:test";
import {
  addComposerAttachments,
  applyComposerUrlProject,
  clearComposerDraft,
  getComposerDraft,
  patchComposerDraft,
  removeComposerAttachment,
  requestComposerProject,
  resetComposerDraft,
  setComposerDraftProject,
  setComposerSubmitting,
  subscribeComposerDraft,
} from "./composer-draft-store";

// `toAttachment` mints an object URL for an image, and the store releases it
// when the attachment leaves the draft. Counted rather than left to Bun's own,
// because what is under test is exactly when each is called.
const realCreate = URL.createObjectURL;
const realRevoke = URL.revokeObjectURL;
let minted: string[];
let revoked: string[];

beforeEach(() => {
  minted = [];
  revoked = [];
  globalThis.URL.createObjectURL = () => {
    const url = `blob:test/${minted.length}`;
    minted.push(url);
    return url;
  };
  globalThis.URL.revokeObjectURL = (url: string) => {
    revoked.push(url);
  };
  resetComposerDraft();
  // The reset releases whatever the last test left, which is not this test's.
  revoked = [];
});

afterEach(() => {
  globalThis.URL.createObjectURL = realCreate;
  globalThis.URL.revokeObjectURL = realRevoke;
});

function png(name = "a.png"): File {
  return new File(["x"], name, { type: "image/png" });
}

test("the snapshot is replaced on a write and not otherwise", () => {
  const before = getComposerDraft();
  expect(getComposerDraft()).toBe(before);

  patchComposerDraft({ prompt: "ship it" });

  const after = getComposerDraft();
  expect(after).not.toBe(before);
  expect(after.prompt).toBe("ship it");
  // Never mutated in place: a snapshot React already holds stays what it was.
  expect(before.prompt).toBe("");
  expect(getComposerDraft()).toBe(after);
});

test("moving the project clears the overrides and nothing the user typed", () => {
  addComposerAttachments([png()]);
  patchComposerDraft({
    prompt: "ship it",
    model: "sonnet",
    profile: "pi",
    worktree: true,
    baseRef: "main",
    urlProject: "web",
  });
  const attachments = getComposerDraft().attachments;

  setComposerDraftProject("general");

  const draft = getComposerDraft();
  expect(draft.projectId).toBe("general");
  expect([draft.model, draft.profile, draft.worktree, draft.baseRef]).toEqual([
    null, null, null, null,
  ]);
  expect(draft.prompt).toBe("ship it");
  expect(draft.attachments).toBe(attachments);
  expect(draft.urlProject).toBe("web");
});

test("a + press moves the project and leaves the address to the arrival", () => {
  requestComposerProject("web");

  expect(getComposerDraft().projectId).toBe("web");
  // Recorded where it is applied, not where the navigation is begun: one that
  // is refused must not leave the address marked as already applied.
  expect(getComposerDraft().urlProject).toBeNull();
});

test("moving to the project already selected writes nothing", () => {
  setComposerDraftProject("web");
  patchComposerDraft({ model: "sonnet" });
  const before = getComposerDraft();
  let heard = 0;
  const unsubscribe = subscribeComposerDraft(() => {
    heard += 1;
  });

  setComposerDraftProject("web");
  requestComposerProject("web");
  unsubscribe();

  expect(getComposerDraft()).toBe(before);
  expect(getComposerDraft().model).toBe("sonnet");
  expect(heard).toBe(0);
});

test("the same address applied twice moves nothing the second time", () => {
  applyComposerUrlProject("web");
  expect(getComposerDraft().projectId).toBe("web");

  // A chip moved between two mounts at `/?project=web`.
  patchComposerDraft({ model: "sonnet" });
  const before = getComposerDraft();
  applyComposerUrlProject("web");

  expect(getComposerDraft()).toBe(before);
  expect(getComposerDraft().model).toBe("sonnet");
});

test("a different address moves the project", () => {
  applyComposerUrlProject("web");
  patchComposerDraft({ model: "sonnet" });

  applyComposerUrlProject("general");

  expect(getComposerDraft().projectId).toBe("general");
  expect(getComposerDraft().urlProject).toBe("general");
  expect(getComposerDraft().model).toBeNull();
});

test("an address with no project is recorded and moves nothing", () => {
  applyComposerUrlProject("web");

  applyComposerUrlProject(undefined);

  expect(getComposerDraft().projectId).toBe("web");
  expect(getComposerDraft().urlProject).toBeNull();
  // And the same project named again after it is a change, so it lands.
  setComposerDraftProject("general");
  applyComposerUrlProject("web");
  expect(getComposerDraft().projectId).toBe("web");
});

test("an address naming the selected project after a plain / keeps the overrides", () => {
  applyComposerUrlProject("web");
  applyComposerUrlProject(undefined);
  patchComposerDraft({ model: "sonnet" });

  applyComposerUrlProject("web");

  const draft = getComposerDraft();
  expect(draft.urlProject).toBe("web");
  expect(draft.projectId).toBe("web");
  expect(draft.model).toBe("sonnet");
});

test("an address that moves the project is one write", () => {
  setComposerDraftProject("general");
  patchComposerDraft({ model: "sonnet" });
  const seen: Array<[string, string | null]> = [];
  const unsubscribe = subscribeComposerDraft(() => {
    const d = getComposerDraft();
    seen.push([d.projectId, d.urlProject]);
  });

  applyComposerUrlProject("web");
  unsubscribe();

  // No snapshot with the address ahead of the project, or the other way round.
  expect(seen).toEqual([["web", "web"]]);
  expect(getComposerDraft().model).toBeNull();
});

test("attachments join the draft, and one taken off releases its URL", () => {
  addComposerAttachments([png("a.png"), png("b.png")]);
  const [a, b] = getComposerDraft().attachments;
  expect(minted).toEqual(["blob:test/0", "blob:test/1"]);
  expect(a!.previewUrl).toBe("blob:test/0");

  removeComposerAttachment(a!.id);

  expect(getComposerDraft().attachments).toEqual([b!]);
  expect(revoked).toEqual(["blob:test/0"]);
});

test("adding nothing and removing an unknown id write nothing", () => {
  const before = getComposerDraft();

  addComposerAttachments([]);
  removeComposerAttachment("nope");

  expect(getComposerDraft()).toBe(before);
  expect(revoked).toEqual([]);
});

test("clearing empties the draft, releases every URL, and keeps the project", () => {
  applyComposerUrlProject("web");
  addComposerAttachments([png("a.png"), png("b.png")]);
  patchComposerDraft({ prompt: "ship it", model: "sonnet", profile: "pi", worktree: true, baseRef: "main" });

  clearComposerDraft();

  const draft = getComposerDraft();
  expect(draft.prompt).toBe("");
  expect(draft.attachments).toEqual([]);
  expect([draft.model, draft.profile, draft.worktree, draft.baseRef]).toEqual([
    null, null, null, null,
  ]);
  expect(revoked).toEqual(["blob:test/0", "blob:test/1"]);
  expect(draft.projectId).toBe("web");
  expect(draft.urlProject).toBe("web");
});

test("a listener hears every write, and nothing once unsubscribed", () => {
  let heard = 0;
  const unsubscribe = subscribeComposerDraft(() => {
    heard += 1;
  });

  patchComposerDraft({ prompt: "a" });
  setComposerDraftProject("web");
  addComposerAttachments([png()]);
  expect(heard).toBe(3);

  unsubscribe();
  patchComposerDraft({ prompt: "b" });

  expect(heard).toBe(3);
});

test("a submit in flight locks the draft until it settles", () => {
  let heard = 0;
  const unsubscribe = subscribeComposerDraft(() => {
    heard += 1;
  });

  setComposerSubmitting(true);
  setComposerSubmitting(true);
  expect(heard).toBe(1);
  expect(getComposerDraft().submitting).toBe(true);

  // Files refused: the submit already snapshotted what it will upload.
  const before = getComposerDraft();
  expect(addComposerAttachments([png()])).toBe(before);
  expect(getComposerDraft()).toBe(before);
  expect(minted).toEqual([]);

  // The success path clears the draft, and the lock goes with it.
  clearComposerDraft();
  expect(getComposerDraft().submitting).toBe(false);
  const heardAfterClear = heard;
  setComposerSubmitting(false);
  expect(heard).toBe(heardAfterClear);
  unsubscribe();

  addComposerAttachments([png()]);
  expect(getComposerDraft().attachments).toHaveLength(1);
});

test("a fresh draft is not submitting", () => {
  expect(getComposerDraft().submitting).toBe(false);
});
