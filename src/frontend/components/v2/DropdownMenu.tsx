import type { ReactNode } from "react";
import { ContextMenu as RadixContextMenu, DropdownMenu as RadixDropdownMenu } from "radix-ui";
import { Check, type LucideIcon } from "lucide-react";
import { KeyHint } from "./KeyHint";
import { cn } from "@/frontend/lib/utils";

/** One row of a menu: an action, a rule between actions, or a heading over a
 * run of them. Actions are what a menu is for — a row that navigates belongs
 * in the palette, not here. */
export type DropdownMenuItem =
  | { separator: true; section?: never; label?: never }
  | { section: true; separator?: never; label: string }
  | {
      separator?: false;
      section?: false;
      label: string;
      /** Lucide component at the leading edge, in muted foreground — or the
       * destructive colour on a destructive row. */
      icon?: LucideIcon;
      /** Caps for the chord that does the same thing without the menu, drawn
       * at the trailing edge with `KeyHint`. */
      keys?: string[];
      disabled?: boolean;
      /** Drawn in the destructive colour. The design spec puts these last,
       * after a separator, with an ellipsis on the label when a confirmation
       * follows — the menu draws what it is given and does not reorder. */
      destructive?: boolean;
      /** A stateful option: the check sits at the trailing edge, before any
       * keys. */
      checked?: boolean;
      /** Hover text, for the words explaining why a row is greyed out — the
       * one moment the row cannot say them itself. */
      title?: string;
      onSelect: () => void;
    };

export interface DropdownMenuProps {
  items: readonly DropdownMenuItem[];
  /**
   * How the menu opens over its child.
   *
   * `"click"` (the default) is an overflow menu: the child is the trigger, and
   * the menu drops from it. `"context"` is a context menu: it opens on a
   * right-click, a ⌃-click on a Mac or a long-press on touch, anywhere over
   * the child, anchored at the pointer rather than the element.
   */
  trigger?: "click" | "context";
  /**
   * The trigger, as a single element. The menu attaches its handlers to it
   * rather than wrapping it in one of its own (Radix's `asChild`), so a tab in
   * a strip stays the element the strip lays out and drags — nothing about
   * its box changes for having a menu.
   */
  children: ReactNode;
  "aria-label"?: string;
  onOpenChange?: (open: boolean) => void;
}

/** The primitives the two Radix menus have in common, named alike. Both are
 * drawn by one function so a context menu and an overflow menu built from the
 * same items look the same, which is the point of the spec having one
 * component for both. */
interface MenuParts {
  Item: typeof RadixDropdownMenu.Item;
  Separator: typeof RadixDropdownMenu.Separator;
  Label: typeof RadixDropdownMenu.Label;
}

const CONTENT_CLASS = cn(
  "z-50 flex min-w-[220px] flex-col gap-px rounded-md border border-border bg-popover p-1",
  "font-sans text-sm leading-ui tracking-ui text-popover-foreground shadow-overlay",
);

function renderItems(items: readonly DropdownMenuItem[], parts: MenuParts): ReactNode {
  return items.map((item, i) => {
    if (item.separator === true) return <parts.Separator key={i} className="my-1 h-px bg-border" />;
    if (item.section === true) {
      return (
        <parts.Label
          key={i}
          className="px-2 pb-0.5 pt-1.5 text-micro font-semibold uppercase tracking-label text-subtle-foreground"
        >
          {item.label}
        </parts.Label>
      );
    }
    const { icon: Icon } = item;
    return (
      <parts.Item
        key={item.label}
        disabled={item.disabled}
        title={item.title}
        onSelect={item.onSelect}
        className={cn(
          "flex h-control cursor-pointer select-none items-center gap-2 rounded-md px-2 outline-none",
          "data-[highlighted]:bg-hover",
          // Greyed out, but still hoverable: a `title` is the only way a
          // disabled row says why it is disabled, and a native tooltip needs
          // the pointer to be able to land on the element. Radix refuses the
          // selection itself — a disabled item is not focusable and its
          // `onSelect` does not fire — so nothing but the tooltip depends on
          // this, and `pointer-events-none` would take exactly the one thing
          // the row still has to offer.
          "data-[disabled]:cursor-default data-[disabled]:opacity-45",
          item.destructive ? "text-destructive" : "text-foreground",
        )}
      >
        {Icon ? (
          <Icon
            size={13}
            className={cn("flex-none", item.destructive ? "text-destructive" : "text-muted-foreground")}
          />
        ) : null}
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
        {item.checked ? <Check size={13} className="flex-none text-primary" /> : null}
        {item.keys ? <KeyHint keys={item.keys} className="flex-none" /> : null}
      </parts.Item>
    );
  });
}

/**
 * Context and overflow menus — the task row's right-click menu, the tab's,
 * the sidebar's project actions.
 *
 * Radix underneath (`radix-ui` is already a dependency, see `Select`), which
 * brings the parts a menu is judged on and that are tedious to get right by
 * hand: anchoring at the pointer for a context menu, flipping to stay on
 * screen, arrow keys and typeahead over the rows, focus returned to where it
 * came from, dismissal on Escape and on a press outside. The two Radix menus
 * are separate primitives with the same sub-parts, so the row rendering is
 * shared and the trigger mode picks the root.
 *
 * Keep menus under about eight rows; anything longer belongs in the palette.
 */
export function DropdownMenu({
  items,
  trigger = "click",
  children,
  "aria-label": ariaLabel,
  onOpenChange,
}: DropdownMenuProps) {
  if (trigger === "context") {
    return (
      <RadixContextMenu.Root onOpenChange={onOpenChange}>
        <RadixContextMenu.Trigger asChild>{children}</RadixContextMenu.Trigger>
        <RadixContextMenu.Portal>
          <RadixContextMenu.Content aria-label={ariaLabel} className={CONTENT_CLASS}>
            {renderItems(items, RadixContextMenu)}
          </RadixContextMenu.Content>
        </RadixContextMenu.Portal>
      </RadixContextMenu.Root>
    );
  }
  return (
    <RadixDropdownMenu.Root onOpenChange={onOpenChange}>
      <RadixDropdownMenu.Trigger asChild>{children}</RadixDropdownMenu.Trigger>
      <RadixDropdownMenu.Portal>
        <RadixDropdownMenu.Content
          align="end"
          sideOffset={4}
          aria-label={ariaLabel}
          className={CONTENT_CLASS}
        >
          {renderItems(items, RadixDropdownMenu)}
        </RadixDropdownMenu.Content>
      </RadixDropdownMenu.Portal>
    </RadixDropdownMenu.Root>
  );
}
