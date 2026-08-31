import type { SelectOption } from "@/frontend/components/v2/Select";

// What a task can be told to run as, in one place because two surfaces choose
// from it: the composer picks per task, and project settings pick the default
// the composer falls back to. Two copies would drift, and the drift would show
// up as a project default the composer cannot display.

export const MODEL_VALUES = ["opus", "sonnet", "haiku"] as const;

export const PERMISSION_MODE_VALUES = [
  "default",
  "acceptEdits",
  "plan",
  "bypassPermissions",
] as const;

/** `""` is not a value — it is the absence of one, which is how both surfaces
 * say "someone below me decides this". For the composer that someone is the
 * project; for the project it is Claude Code's own default. Same empty string
 * either way, because both end up as a field left off the wire. */
export const UNSET = "";

/** The list, with the empty choice first under whatever that surface calls it. */
export function optionsWithFallback(
  values: readonly string[],
  fallbackLabel: string,
): SelectOption[] {
  return [{ value: UNSET, label: fallbackLabel }, ...values.map((v) => ({ value: v, label: v }))];
}

/** A stored value the select can actually display. A column holding something
 * this build has no option for would otherwise leave the control blank; the
 * empty choice is both honest and identical in effect, since an absent field
 * resolves to exactly that. */
export function knownValue(options: SelectOption[], value: string | null): string {
  if (value && options.some((o) => o.value === value)) return value;
  return UNSET;
}
