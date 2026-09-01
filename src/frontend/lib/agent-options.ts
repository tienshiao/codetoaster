import type { SelectOption } from "@/frontend/components/v2/Select";

// What a task can be told to run as, in one place because two surfaces choose
// from it: the composer picks per task, and project settings pick the default
// the composer falls back to. Two copies would drift, and the drift would show
// up as a project default the composer cannot display.

/** The models, most capable first.
 *
 * Value and label are not the same string and cannot be derived from each
 * other: the value is what goes on `claude --model` and is lowercase, the
 * label is the model's name and is not. Listing both is what stopped the
 * chips reading "opus". */
export const MODEL_OPTIONS: readonly SelectOption[] = [
  { value: "fable", label: "Fable" },
  { value: "opus", label: "Opus" },
  { value: "sonnet", label: "Sonnet" },
  { value: "haiku", label: "Haiku" },
];

/** `""` is not a value — it is the absence of one, which is how both surfaces
 * say "someone below me decides this". For the composer that someone is the
 * project; for the project it is Claude Code's own default. Same empty string
 * either way, because both end up as a field left off the wire. */
export const UNSET = "";

/** The models, with the empty choice first under whatever that surface calls it. */
export function modelOptions(fallbackLabel: string): SelectOption[] {
  return [{ value: UNSET, label: fallbackLabel }, ...MODEL_OPTIONS];
}

/** A stored value the select can actually display. A column holding something
 * this build has no option for would otherwise leave the control blank; the
 * empty choice is both honest and identical in effect, since an absent field
 * resolves to exactly that. */
export function knownValue(options: SelectOption[], value: string | null): string {
  if (value && options.some((o) => o.value === value)) return value;
  return UNSET;
}
