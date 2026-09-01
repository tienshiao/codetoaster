import { useMemo, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { Select as RadixSelect } from "radix-ui";
import { Check, ChevronDown, Search } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/frontend/lib/utils";

export interface SelectOption {
  value: string;
  label: string;
  /** Drawn at the trailing edge of the row in the popup, never on the trigger:
   * a colour strip, a sample, a hint. It is what lets a list be chosen from
   * rather than merely read — the terminal themes show their palette here. */
  trailing?: ReactNode;
  disabled?: boolean;
}

export type SelectSize = "sm" | "md";

export interface SelectProps {
  /** Sits inline before the value, in muted foreground — "project", "model".
   * Also the control's accessible name, unless `aria-label` overrides it,
   * since the value alone does not say what it is a value of. */
  label?: string;
  "aria-label"?: string;
  options: readonly SelectOption[];
  value: string;
  onValueChange: (value: string) => void;
  /** Lucide component drawn at the leading edge. */
  icon?: LucideIcon;
  /** sm 24px · md 28px (chrome default). */
  size?: SelectSize;
  disabled?: boolean;
  /** Turns typing into a filter rather than a jump-to-first-match, and shows
   * what has been typed at the top of the popup under this placeholder. Only
   * worth it for a list too long to scan — the terminal themes are 157. */
  filterPlaceholder?: string;
  id?: string;
  className?: string;
}

/** Radix refuses an item whose value is the empty string, and reads a root
 * value of `""` as "show the placeholder". `""` is exactly what this system
 * means by "someone below me decides this" (see `agent-options.ts`), so it is
 * swapped for a private sentinel at the boundary and swapped back on the way
 * out. Callers keep the empty string; Radix never sees it. */
const UNSET_SENTINEL = "__ct_unset";
const toRadix = (value: string) => (value === "" ? UNSET_SENTINEL : value);
const fromRadix = (value: string) => (value === UNSET_SENTINEL ? "" : value);

/** Whether a keystroke is a character being typed rather than a command.
 * Radix reads the same thing the same way for its own typeahead, which is what
 * `filterPlaceholder` replaces. */
const isTyping = (event: ReactKeyboardEvent) =>
  !event.ctrlKey && !event.altKey && !event.metaKey && event.key.length === 1;

/**
 * A one-of-several choice, worn as a chip: label, value, chevron.
 *
 * Radix over a native `<select>` (TASK-75). The native element brought
 * typeahead, arrow keys and the accessibility tree for free, and for a long
 * while that was the better trade — but it also brought the OS menu, which
 * cannot be styled at all, and that is the part that showed. Radix keeps the
 * three things worth keeping and hands back the popup: this one is drawn from
 * the same tokens as everything around it, can filter, and can put a preview
 * beside each row. What is given up is the platform picker on touch, an iOS
 * wheel instead of a scrolling list; TASK-33 revisits that on a real device.
 *
 * `radix-ui` was already a dependency, so this costs nothing new and does not
 * regrow `components/ui/`.
 */
export function Select({
  label,
  "aria-label": ariaLabel,
  options,
  value,
  onValueChange,
  icon: Icon,
  size = "md",
  disabled = false,
  filterPlaceholder,
  id,
  className,
}: SelectProps) {
  const filtering = filterPlaceholder !== undefined;
  const [query, setQuery] = useState("");

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((option) => option.label.toLowerCase().includes(needle));
  }, [options, query]);

  // The trigger's text comes from the options rather than from the selected
  // `Select.ItemText` portaling into it, which is Radix's default. Filtering
  // unmounts items, and an unmounted selected item would take the trigger's
  // own label with it — so the value is read from the list this component was
  // given, which is true whether or not the popup is open. Passing children to
  // `Select.Value` is how Radix is told to stand down (`valueNodeHasChildren`).
  const selected = options.find((option) => option.value === value);

  return (
    <RadixSelect.Root
      value={toRadix(value)}
      onValueChange={(next) => onValueChange(fromRadix(next))}
      disabled={disabled}
      // The filter is per-opening: a query left behind would hide the list the
      // next time the chip is pressed, on a box the user cannot see until they
      // look up.
      onOpenChange={(open) => {
        if (!open) setQuery("");
      }}
    >
      <RadixSelect.Trigger
        id={id}
        aria-label={ariaLabel ?? label}
        className={cn(
          "relative inline-flex items-center gap-1.5 rounded-md border border-input bg-pane pl-2 pr-1.5",
          "cursor-pointer font-sans tracking-ui text-foreground outline-none",
          "focus:border-ring data-[state=open]:border-ring",
          "disabled:cursor-default disabled:opacity-50",
          size === "sm" ? "h-control-sm text-xs" : "h-control text-sm",
          className,
        )}
      >
        {Icon ? <Icon size={13} className="flex-none text-muted-foreground" /> : null}
        {label ? <span className="flex-none text-muted-foreground">{label}</span> : null}
        {/* `flex-auto` takes the spare width of a chip that has some (a
            settings row) while keeping the basis at content size, so a chip
            that sizes to itself (the composer's) is unchanged. */}
        <RadixSelect.Value data-slot="value" className="min-w-0 flex-auto truncate text-left">
          {selected?.label ?? ""}
        </RadixSelect.Value>
        <RadixSelect.Icon asChild>
          <ChevronDown size={13} className="ml-auto flex-none text-subtle-foreground" />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>

      <RadixSelect.Portal>
        <RadixSelect.Content
          position="popper"
          sideOffset={4}
          // `Dialog` binds Escape to the document and knows nothing about
          // layers above it, so an unhandled Escape here would close the popup
          // and the dialog holding it in the same keystroke. Radix dismisses on
          // the capture phase, which is early enough to take the event out of
          // the path before the document's own listener is reached.
          onEscapeKeyDown={(event) => event.stopPropagation()}
          // Typing filters instead of jumping to the first match. Radix's own
          // typeahead reads the same keystrokes, and `preventDefault` is how it
          // is told to stand down: Radix composes a caller's handler ahead of
          // its own and skips its own once the event is defaulted.
          //
          // Not a focusable input at the top of the popup, which is the obvious
          // shape and does not work: Radix focuses the selected item as soon as
          // the popper reports itself positioned, so a box that took focus on
          // mount would lose it a frame later. Keeping focus in the list is
          // also what keeps the arrow keys and Enter working untouched — this
          // only replaces what a letter does.
          onKeyDown={
            filtering
              ? (event) => {
                  if (isTyping(event)) setQuery((q) => q + event.key);
                  else if (event.key === "Backspace") setQuery((q) => q.slice(0, -1));
                  else return;
                  event.preventDefault();
                  // Filtering unmounts rows, and an unmounted row takes the
                  // focus with it — which would leave the popup deaf to the
                  // next keystroke, since this listener is on the content.
                  // Parking focus on the content itself also resets the
                  // highlight, so ArrowDown starts from the top of what is
                  // left rather than from wherever the old list had got to.
                  event.currentTarget.focus();
                }
              : undefined
          }
          className={cn(
            "z-50 overflow-hidden rounded-md border border-border bg-pane shadow-overlay",
            "font-sans text-sm leading-ui tracking-ui text-foreground",
            // Never narrower than the chip it came from, and never taller than
            // the room the popper measured.
            "min-w-[var(--radix-select-trigger-width)]",
            "max-h-[min(22rem,var(--radix-select-content-available-height))]",
            "flex flex-col",
          )}
        >
          {/* What has been typed, not a field to type into — see `onKeyDown`.
              Always drawn, so the popup does not change height on the first
              keystroke, and so an empty list has its explanation above it. */}
          {filtering ? (
            <div className="flex h-row flex-none items-center gap-1.5 border-b border-border px-2 text-xs">
              <Search size={12} className="flex-none text-subtle-foreground" />
              <span
                aria-live="polite"
                className={cn("truncate", query ? "text-foreground" : "text-subtle-foreground")}
              >
                {query || filterPlaceholder}
              </span>
            </div>
          ) : null}
          <RadixSelect.Viewport className="min-h-0 flex-1 overflow-y-auto p-1">
            {shown.map((option) => (
              <RadixSelect.Item
                key={option.value}
                value={toRadix(option.value)}
                disabled={option.disabled}
                className={cn(
                  "flex h-row cursor-pointer select-none items-center gap-2 rounded-sm pl-1.5 pr-2 outline-none",
                  "data-[highlighted]:bg-hover",
                  "data-[state=checked]:bg-selected data-[state=checked]:text-selected-foreground",
                  "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
                )}
              >
                {/* A fixed slot rather than a conditional glyph, so the labels
                    line up whether or not their row is the chosen one. */}
                <span className="flex w-3.5 flex-none items-center justify-center">
                  <RadixSelect.ItemIndicator>
                    <Check size={12} />
                  </RadixSelect.ItemIndicator>
                </span>
                <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
                {option.trailing ? (
                  <span className="ml-auto flex flex-none items-center">{option.trailing}</span>
                ) : null}
              </RadixSelect.Item>
            ))}
            {shown.length === 0 ? (
              <p className="px-2 py-1.5 text-xs text-subtle-foreground">No matches</p>
            ) : null}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}
