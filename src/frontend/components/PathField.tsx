import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { ChevronDown, ChevronRight, Folder, FolderOpen, FolderTree } from "lucide-react";
import { Button } from "@/frontend/components/v2/Button";
import { TextInput } from "@/frontend/components/v2/TextInput";
import { useDirectories } from "@/frontend/hooks/use-directories";
import {
  ancestorsOf,
  childPath,
  expandTilde,
  moveSelection,
  suggestionValue,
  toDisplayPath,
} from "@/frontend/utils/path-suggest";
import { cn } from "@/frontend/lib/utils";

/**
 * The repository-path field and its directory browser, restored onto v2.
 *
 * v1's `InitialPathAutocomplete` and `DirectoryPickerDialog` are the reference
 * for the behaviour and are deliberately *not* reused: they are built on
 * `components/ui/` and go away with the rest of v1 at TASK-28, and making one
 * component serve two dialog systems would outlive the duplication it saved.
 *
 * The browser is a *view*, not a second modal. `v2/Dialog` puts its Escape
 * handler on `document` and renders `fixed z-50`, so a dialog opened over a
 * dialog would take one Escape for both and stack at an undefined z-order.
 * `NewProjectButton` therefore swaps the dialog's body and re-labels its
 * footer.
 */

/** What `/api/directories` wants for "list what is *inside* this". */
function listingPath(absolute: string): string {
  return absolute.endsWith("/") ? absolute : absolute + "/";
}

/** Drops a trailing separator, except from root, where it is the whole name. */
function trimSlash(absolute: string): string {
  return absolute.length > 1 && absolute.endsWith("/") ? absolute.slice(0, -1) : absolute;
}

export interface PathFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Enters browse mode. Owned by the dialog, whose footer changes with it. */
  onBrowse: () => void;
  autoFocus?: boolean;
}

export function PathField({
  id,
  label,
  value,
  onChange,
  placeholder,
  onBrowse,
  autoFocus,
}: PathFieldProps) {
  // Empty rather than `value`: the list is a response to typing. Seeding it
  // would pop a dropdown open the moment the field mounts holding a path —
  // which is exactly what returning from the browser does, and suggesting the
  // folder just chosen is noise.
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);

  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blur = useRef<ReturnType<typeof setTimeout> | null>(null);
  const list = useRef<HTMLDivElement>(null);

  const { data: suggestions } = useDirectories(query, { enabled: query.length > 0 });
  const directories = suggestions?.directories ?? [];

  const ask = useCallback((path: string) => {
    if (debounce.current) clearTimeout(debounce.current);
    if (!path) {
      setQuery("");
      return;
    }
    debounce.current = setTimeout(() => setQuery(path), 200);
  }, []);

  // An answer that has directories in it is what opens the list; an answer with
  // none closes it. Keyed off the data rather than off typing, so a request
  // that resolves after the user has stopped still lands.
  useEffect(() => {
    if (!suggestions) return;
    setOpen(suggestions.directories.length > 0);
    setIndex(0);
  }, [suggestions]);

  /**
   * Escape closes the list and nothing else.
   *
   * The dialog listens on `document`, so an Escape that merely bubbles out of
   * the input reaches it and takes the whole dialog with it. This listener runs
   * in the *capture* phase — ahead of every bubble listener, the dialog's
   * included — and stops the event dead. It is registered only while the list
   * is open, so once the list is gone Escape means what it always meant.
   */
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [open]);

  const accept = useCallback(
    (name: string) => {
      if (!suggestions) return;
      const next = suggestionValue(suggestions.parent, name);
      onChange(next);
      setOpen(false);
      // Ask again for what is inside the directory just accepted, so tabbing
      // down a tree of them is one keystroke per level.
      ask(next);
    },
    [ask, onChange, suggestions],
  );

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (!open || directories.length === 0) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setIndex((i) => moveSelection(i, directories.length, e.key === "ArrowDown" ? 1 : -1));
    } else if (e.key === "Enter" || e.key === "Tab") {
      // Enter would otherwise submit the dialog — creating the project from a
      // half-typed path is the one outcome this field must not have.
      e.preventDefault();
      const name = directories[index];
      if (name) accept(name);
    }
  };

  useEffect(() => {
    if (!open) return;
    (list.current?.children[index] as HTMLElement | undefined)?.scrollIntoView?.({
      block: "nearest",
    });
  }, [index, open]);

  useEffect(
    () => () => {
      if (debounce.current) clearTimeout(debounce.current);
      if (blur.current) clearTimeout(blur.current);
    },
    [],
  );

  const listId = `${id}-suggestions`;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
          {label}
        </label>
        <Button type="button" variant="ghost" size="sm" icon={FolderTree} onClick={onBrowse}>
          Browse
        </Button>
      </div>
      <div className="relative">
        <TextInput
          id={id}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            ask(e.target.value);
          }}
          onKeyDown={onKeyDown}
          onFocus={() => {
            if (directories.length > 0) setOpen(true);
          }}
          onBlur={() => {
            blur.current = setTimeout(() => setOpen(false), 150);
          }}
          placeholder={placeholder}
          autoFocus={autoFocus}
          autoComplete="off"
          role="combobox"
          aria-expanded={open && directories.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && directories[index] ? `${listId}-${index}` : undefined}
          data-1p-ignore
        />
        {open && directories.length > 0 ? (
          // Absolute, so the panel's flex column does not reflow when it opens,
          // and z-10 so it covers the footer below it. The dialog panel has no
          // `overflow-hidden`, which is what keeps this from being clipped.
          <div
            ref={list}
            id={listId}
            role="listbox"
            aria-label={label}
            className={cn(
              "absolute top-full right-0 left-0 z-10 mt-1 max-h-48 overflow-y-auto",
              "rounded-md border border-border bg-popover py-1 text-popover-foreground shadow-overlay",
            )}
          >
            {directories.map((name, i) => (
              <div
                key={name}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === index}
                className={cn(
                  "flex h-row cursor-pointer items-center px-2.5 font-mono text-xs tracking-mono",
                  i === index ? "bg-selected text-selected-foreground" : "hover:bg-hover",
                )}
                // `mousedown`, not `click`: click lands after blur, and blur
                // closes the list out from under the pointer.
                onMouseDown={(e) => {
                  e.preventDefault();
                  if (blur.current) clearTimeout(blur.current);
                  accept(name);
                }}
                onMouseEnter={() => setIndex(i)}
              >
                {name}/
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

interface TreeContext {
  expanded: Set<string>;
  selected: string | null;
  /** The node the tree should scroll to once it exists — the branch it opened on. */
  revealPath: string | null;
  pick: (absolute: string) => void;
  toggle: (absolute: string) => void;
  expand: (absolute: string) => void;
  commit: (absolute: string) => void;
  reveal: (el: HTMLElement | null) => void;
}

function DirRow({
  absolute,
  name,
  depth,
  tree,
}: {
  absolute: string;
  name: string;
  depth: number;
  tree: TreeContext;
}) {
  const expanded = tree.expanded.has(absolute);
  const selected = tree.selected === absolute;
  const Chevron = expanded ? ChevronDown : ChevronRight;
  const FolderIcon = expanded ? FolderOpen : Folder;

  return (
    <>
      <div
        style={{ paddingLeft: 8 + depth * 12 }}
        className={cn(
          "flex h-row items-center gap-[3px] rounded-md pr-2",
          selected ? "bg-selected text-selected-foreground" : "text-foreground hover:bg-hover",
        )}
      >
        {/* Collapsing is the chevron's job alone. Were the row to toggle, the
            second click of a double-click would land after the list had already
            reflowed under the pointer — which is how "use this folder" ended up
            choosing the folder above it. */}
        <button
          type="button"
          aria-label={`${expanded ? "Collapse" : "Expand"} ${name}`}
          onClick={() => tree.toggle(absolute)}
          className={cn(
            "grid size-[18px] flex-none cursor-pointer place-items-center rounded-sm",
            "text-muted-foreground hover:text-foreground",
            "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring",
          )}
        >
          <Chevron size={13} />
        </button>
        <button
          type="button"
          ref={tree.revealPath === absolute ? tree.reveal : undefined}
          // Opening, never closing: clicking a folder should go deeper, and
          // growing the list below the pointer leaves the row where it was.
          onClick={() => {
            tree.pick(absolute);
            tree.expand(absolute);
          }}
          onDoubleClick={() => tree.commit(absolute)}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight" && !expanded) {
              e.preventDefault();
              tree.expand(absolute);
            } else if (e.key === "ArrowLeft" && expanded) {
              e.preventDefault();
              tree.toggle(absolute);
            }
          }}
          className={cn(
            "flex h-row min-w-0 flex-1 cursor-pointer items-center gap-[7px] rounded-md text-left",
            "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring",
          )}
        >
          <FolderIcon size={14} className="flex-none text-[var(--ct-amber-500)]" />
          <span className="min-w-0 flex-1 truncate font-mono text-xs tracking-mono">{name}</span>
        </button>
      </div>
      {expanded ? <DirChildren absolute={absolute} depth={depth + 1} tree={tree} /> : null}
    </>
  );
}

/**
 * The children of one expanded node, each with its own query.
 *
 * One `useDirectories` per open node rather than a hand-rolled cache: mounting
 * a node is what fetches it, unmounting stops caring, and react-query's 60s
 * `staleTime` makes collapsing and re-expanding free. It is also why the
 * loading state is a row here instead of a spinner on the parent.
 */
function DirChildren({
  absolute,
  depth,
  tree,
}: {
  absolute: string;
  depth: number;
  tree: TreeContext;
}) {
  const { data, isPending, isError } = useDirectories(listingPath(absolute));
  const indent = { paddingLeft: 8 + depth * 12 + 20 };

  if (isPending) {
    return (
      <div style={indent} className="flex h-row items-center text-xs text-subtle-foreground">
        Loading…
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div style={indent} className="flex h-row items-center text-xs text-subtle-foreground">
        Could not read this folder
      </div>
    );
  }
  if (data.directories.length === 0) {
    return (
      <div style={indent} className="flex h-row items-center text-xs text-subtle-foreground">
        No subfolders
      </div>
    );
  }
  return (
    <>
      {data.directories.map((name) => (
        <DirRow
          key={name}
          absolute={childPath(absolute, name)}
          name={name}
          depth={depth}
          tree={tree}
        />
      ))}
    </>
  );
}

export interface DirectoryBrowserProps {
  /** Seeds which branch is open — whatever the field currently holds. */
  initialPath: string;
  /** The highlighted folder as the field would spell it, or null for none. */
  onSelectionChange: (path: string | null) => void;
  /** Double-click: this one, and back to the form. */
  onCommit: (path: string) => void;
}

export function DirectoryBrowser({
  initialPath,
  onSelectionChange,
  onCommit,
}: DirectoryBrowserProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(["/"]));
  const [selected, setSelected] = useState<string | null>(null);
  const [revealPath, setRevealPath] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const revealed = useRef(false);
  const seeded = useRef(false);

  // The root listing carries `home`, which is the only way to turn the `~` the
  // field holds into a path the tree can address — so the seeding below waits
  // for it rather than guessing.
  const { data: root } = useDirectories("/");
  const home = root?.home ?? "";

  const typed = initialPath.trim();
  const target = home ? trimSlash(expandTilde(typed || home, home)) : "";
  const parent = target && target !== "/" ? target.slice(0, target.lastIndexOf("/")) || "/" : "";

  // The field is usually mid-word — "~/Projects/c" is a prefix the autocomplete
  // was still filtering on, not a directory. Listing the parent is how the tree
  // finds out, and it is a request it would have made anyway to draw that
  // level, so the answer is normally already in the cache.
  const { data: parentListing } = useDirectories(listingPath(parent || "/"), {
    enabled: !!parent,
  });

  useEffect(() => {
    if (!home || seeded.current) return;
    if (parent && !parentListing) return;
    seeded.current = true;

    const name = target.slice(target.lastIndexOf("/") + 1);
    const real = !parent || (parentListing?.directories.includes(name) ?? false);
    const branch = real ? target : parent;
    setExpanded(new Set(ancestorsOf(branch)));
    // Scrolled to even when nothing is selected: on an empty field the branch
    // is home, which is a long way down a tree that starts at "/".
    setRevealPath(branch);
    // An empty field opens on home without pre-arming "Use this folder": the
    // user asked to look around, not to confirm a folder they have not seen.
    if (typed) {
      setSelected(branch);
      onSelectionChange(toDisplayPath(branch, home));
    }
  }, [home, parent, parentListing, target, typed, onSelectionChange]);

  // Focus lands nowhere when the Browse button unmounts, so the tree takes it
  // and Tab continues from the rows rather than from the top of the document.
  useEffect(() => {
    scroller.current?.focus();
  }, []);

  const toggle = useCallback((absolute: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(absolute)) next.add(absolute);
      return next;
    });
  }, []);

  const expand = useCallback((absolute: string) => {
    setExpanded((prev) => (prev.has(absolute) ? prev : new Set(prev).add(absolute)));
  }, []);

  const pick = useCallback(
    (absolute: string) => {
      setSelected(absolute);
      onSelectionChange(toDisplayPath(absolute, home));
    },
    [home, onSelectionChange],
  );

  const commit = useCallback(
    (absolute: string) => onCommit(toDisplayPath(absolute, home)),
    [home, onCommit],
  );

  const reveal = useCallback((el: HTMLElement | null) => {
    if (!el || revealed.current) return;
    revealed.current = true;
    el.scrollIntoView?.({ block: "center" });
  }, []);

  const tree: TreeContext = {
    expanded,
    selected,
    revealPath,
    pick,
    toggle,
    expand,
    commit,
    reveal,
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="truncate rounded-md border border-border bg-background px-2.5 py-1.5 font-mono text-xs tracking-mono text-muted-foreground">
        {selected ? toDisplayPath(selected, home) : "No folder selected"}
      </div>
      <div
        ref={scroller}
        tabIndex={-1}
        className="max-h-[min(50vh,18rem)] overflow-y-auto rounded-md border border-border p-1 outline-none"
      >
        <DirRow absolute="/" name="/" depth={0} tree={tree} />
      </div>
      <p className="text-xs text-subtle-foreground">
        Click a folder to open it, double-click to use it.
      </p>
    </div>
  );
}
