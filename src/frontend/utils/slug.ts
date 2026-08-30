// A task's URL identity (§7.3): `{slugified-title}-{uuid}`.
//
// The title is decoration and the uuid is the address. Everything that looks a
// task up reads the last 36 characters, so renaming a task changes only the
// prefix and every link written before the rename still resolves — which is
// what lets the stored title be projected over (naming.ts) without invalidating
// a URL somebody kept.

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function buildTaskSlug(task: { title: string; id: string }): string {
  return `${slugify(task.title)}-${task.id}`;
}

/**
 * The task id a slug addresses, and the title prefix it was written with.
 *
 * The prefix is returned for completeness rather than for lookup: it is
 * whatever the title was when the link was made, which may be neither the
 * current title nor a title at all.
 */
export function parseTaskSlug(slug: string): { title: string; id: string } {
  return {
    title: slug.slice(0, -37),
    id: slug.slice(-36),
  };
}
