import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from "react";
import { File, Folder } from "lucide-react";
import { useDirectories } from "@/frontend/hooks/use-directories";
import { useProjectFileSearch } from "@/frontend/hooks/use-project-file-search";
import {
  childPath,
  expandTilde,
  moveSelection,
  toDisplayPath,
} from "@/frontend/utils/path-suggest";
import {
  applyMention,
  findMention,
  isAbsoluteQuery,
  type Mention,
} from "@/frontend/utils/mention";
import { cn } from "@/frontend/lib/utils";

/**
 * The composer's `@` completion (TASK-100): the list under the prompt, and the
 * hook that decides what is in it.
 *
 * Apart from `Composer.tsx` because it is the whole of a second interaction —
 * a debounce, two data sources, a highlight, a keyboard grammar and a caret to
 * place — and the composer is already the file where submitting, attaching and
 * dragging meet. The arithmetic is one level further out again, in
 * `utils/mention.ts`, where `bun test` can reach it without a DOM.
 */

/** How long the typing has to stop before the query goes out. Shorter than the
 * path field's 200ms: this one is under the caret while a sentence is being
 * written, and a list that lags the word being typed reads as broken. */
const DEBOUNCE_MS = 150;
/** Long enough for a `mousedown` on a row to land before the blur it caused
 * closes the list out from under the pointer. */
const BLUR_MS = 150;

export interface MentionRow {
  /** What goes into the prompt after the `@`. */
  path: string;
  /** What the row reads as — a bare name under an absolute listing, the whole
   * relative path for a project hit, since that is what distinguishes two files
   * with the same name. */
  label: string;
  isDirectory: boolean;
}

export interface UseMentionOptions {
  /** The prompt, as the composer holds it. */
  value: string;
  onValue: (next: string) => void;
  /** The field itself, for placing the caret after an accept. */
  textarea: RefObject<HTMLTextAreaElement | null>;
  /**
   * Whose files a relative query searches. Undefined for a project with no
   * directory — "General" — which is how a relative query there offers nothing
   * rather than asking a route that would only 400.
   */
  projectId?: string;
  /** The listbox's DOM id, which the textarea points `aria-controls` at. */
  listId?: string;
}

/**
 * The state behind the list: which token is being completed, what has been
 * asked for it, and what an accept writes back.
 *
 * The mention is set from `onChange` alone, never from a click or a selection
 * change. That is the whole difference between "clicking into an existing
 * `@path` opens nothing" and "typing inside one re-queries on the prefix" —
 * both of which are wanted, and neither of which a caret listener could tell
 * apart. The keys, though, do check where the caret is before they act: a
 * caret that has since left the token (a click, Home) means the list is about
 * text the user is no longer at, and Enter there is a newline, not an accept.
 *
 * Whether the list is on screen is *derived*, not stored: a mention, a query
 * that has answered with rows, and no dismissal since the last keystroke. A
 * stored `open` flag reconciled by an effect had two ways to disagree with
 * the screen — Escape's dismissal could be undone by an answer arriving late,
 * and the key handlers could believe in a list that had no rows.
 */
export function useMention({
  value,
  onValue,
  textarea,
  projectId,
  listId = "composer-mentions",
}: UseMentionOptions) {
  const [mention, setMention] = useState<Mention | null>(null);
  const [query, setQuery] = useState("");
  // Escape or a blur since the last keystroke. Typing clears it, which is what
  // lets the list come back for the same token once the user resumes.
  const [dismissed, setDismissed] = useState(false);
  const [index, setIndex] = useState(0);
  // Where the caret goes once React has committed the new prompt. Held as
  // state rather than written in the handler because the value it indexes into
  // does not exist in the DOM yet.
  const [pendingCaret, setPendingCaret] = useState<number | null>(null);

  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blur = useRef<ReturnType<typeof setTimeout> | null>(null);

  // `/` and `~` are the filesystem; anything else is the project. The two are
  // different routes, and the raw query goes to the lister tilde and all —
  // expanding it here would rewrite a `~` the user typed into a path they did
  // not.
  const absolute = isAbsoluteQuery(query);
  const listing = useDirectories(query, { enabled: absolute, files: true });
  const search = useProjectFileSearch(absolute ? undefined : projectId, absolute ? "" : query);

  const rows = useMemo<MentionRow[]>(() => {
    if (!query) return [];
    if (absolute) {
      const data = listing.data;
      if (!data) return [];
      // The lister answers with a *display* parent — home collapsed to `~`,
      // root as "" — because that is what the path field shows. The token has
      // to stay in the form the user typed instead: an absolute prefix must
      // not come back as `~/…` because it happened to pass through home, and a
      // bare `~` (which the lister resolves as a prefix of home's *siblings*,
      // so its parent is absolute) must not come back as `/Users/…`.
      const tilde = query.startsWith("~");
      return (data.entries ?? []).map((entry) => {
        const abs = childPath(expandTilde(data.parent, data.home), entry.name);
        return {
          path: tilde ? toDisplayPath(abs, data.home) : abs,
          label: entry.name + (entry.isDirectory ? "/" : ""),
          isDirectory: entry.isDirectory,
        };
      });
    }
    // The fuzzy search answers with tracked files, relative to the project's
    // directory — which is exactly what belongs in the prompt.
    return (search.data?.results ?? []).map((result) => ({
      path: result.path,
      label: result.path,
      isDirectory: false,
    }));
  }, [absolute, query, listing.data, search.data]);

  const answer = absolute ? listing.data : search.data;
  const fetching = absolute ? listing.isFetching : search.isFetching;
  // A token is being completed and nothing has closed the list since.
  const active = mention !== null && query.length > 0 && !dismissed;
  const showing = active && rows.length > 0;
  // The answer for the current query is still a round trip away: the list is
  // shut and there is nothing to accept, but the Enter that took a directory —
  // struck again to go one level deeper — must not become a newline inside the
  // token. The same gate `PathField` keeps as `awaitingSuggestions`.
  const awaiting = active && answer === undefined && fetching;

  // A new answer puts the highlight back on the top row.
  useEffect(() => {
    setIndex(0);
  }, [rows]);

  /**
   * Escape closes the list and nothing else.
   *
   * In the capture phase on `document`, ahead of every bubble listener, so a
   * shell-level binding — a dialog, a palette — does not take the same Escape
   * that was meant for this list. Registered only while the list is actually
   * on screen, so an Escape struck while an answer is still in flight — or
   * after the list has gone — means what it always meant.
   */
  useEffect(() => {
    if (!showing) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      setDismissed(true);
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [showing]);

  // After the commit, and only for an accept: `pendingCaret` is cleared by the
  // same effect that reads it, so ordinary typing — which never sets it — does
  // not get its caret moved.
  useLayoutEffect(() => {
    if (pendingCaret === null) return;
    const el = textarea.current;
    el?.focus();
    el?.setSelectionRange(pendingCaret, pendingCaret);
    setPendingCaret(null);
  }, [pendingCaret, textarea]);

  useEffect(
    () => () => {
      if (debounce.current) clearTimeout(debounce.current);
      if (blur.current) clearTimeout(blur.current);
    },
    [],
  );

  const onChange = useCallback(
    (e: ChangeEvent<HTMLTextAreaElement>) => {
      const text = e.target.value;
      const caret = e.target.selectionStart ?? text.length;
      onValue(text);

      const found = findMention(text, caret);
      setMention(found);
      setDismissed(false);
      if (debounce.current) clearTimeout(debounce.current);
      // A blur that was about to close the list is overtaken by the typing
      // that followed it; left armed it would close the list it re-opened.
      if (blur.current) clearTimeout(blur.current);
      if (!found) {
        // Typed out of the token: the list has nothing to be about any more,
        // and the cleared query is what stops the hooks asking.
        setQuery("");
        return;
      }
      debounce.current = setTimeout(() => setQuery(found.query), DEBOUNCE_MS);
    },
    [onValue],
  );

  const accept = useCallback(
    (row: MentionRow | undefined) => {
      if (!row || !mention) return;
      const next = applyMention(value, mention, row.path, row.isDirectory ? "directory" : "file");
      onValue(next.text);
      setPendingCaret(next.caret);
      if (blur.current) clearTimeout(blur.current);
      if (debounce.current) clearTimeout(debounce.current);

      if (!row.isDirectory) {
        // The token is finished — it ends in a space — so there is nothing left
        // to complete.
        setMention(null);
        setQuery("");
        return;
      }
      // A directory keeps the token open one level down, and is asked for
      // immediately: the debounce is for typing, and this was a decision. Read
      // back off the new text the same way a keystroke would be, so what
      // counts as the token is defined in one place.
      const found = findMention(next.text, next.caret);
      setMention(found);
      setDismissed(false);
      setQuery(found?.query ?? "");
    },
    [mention, onValue, value],
  );

  /**
   * The keys the list owns, ahead of the composer's own.
   *
   * Returns whether it took the event, so ⌘⏎ — which it never takes — reaches
   * the submit with the list open exactly as it does with it shut. Plain Enter
   * is the opposite: with rows on screen it means "take this one", and must not
   * start a task. Escape is the document listener's; by the time a keydown
   * reaches React it has already been stopped there.
   */
  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLTextAreaElement>): boolean => {
      // An IME's Enter commits the composition, not the row.
      if (e.nativeEvent.isComposing) return false;
      if (!active || !mention) return false;
      // The caret has to still be in the token. A click or Home moves it out
      // without a change event, and an accept then would rewrite text nowhere
      // near where the user is looking.
      const el = e.currentTarget;
      const caret = el.selectionStart;
      if (el.selectionEnd !== caret || caret <= mention.start || caret > mention.end) {
        setDismissed(true);
        return false;
      }
      const plainEnter = e.key === "Enter" && !(e.metaKey || e.ctrlKey);
      const forwardTab = e.key === "Tab" && !e.shiftKey;
      if (!showing) {
        if (awaiting && (plainEnter || forwardTab)) {
          e.preventDefault();
          return true;
        }
        return false;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setIndex((i) => moveSelection(i, rows.length, e.key === "ArrowDown" ? 1 : -1));
        return true;
      }
      if (plainEnter || forwardTab) {
        e.preventDefault();
        accept(rows[index]);
        return true;
      }
      return false;
    },
    [accept, active, awaiting, index, mention, rows, showing],
  );

  const onBlur = useCallback(() => {
    blur.current = setTimeout(() => setDismissed(true), BLUR_MS);
  }, []);

  return {
    /** Whether there is a list on screen. */
    open: showing,
    rows,
    index,
    listId,
    activeId: showing ? `${listId}-${index}` : undefined,
    onChange,
    onKeyDown,
    onBlur,
    accept,
    setIndex,
  };
}

export interface MentionSuggestionsProps {
  id: string;
  rows: MentionRow[];
  index: number;
  onHighlight: (index: number) => void;
  onAccept: (row: MentionRow) => void;
}

/**
 * The list itself, absolutely positioned under the textarea by the `relative`
 * wrapper the composer puts around it — under the field rather than at the
 * caret, because the prompt is prose and a popover chasing the caret through it
 * would move on every keystroke.
 */
export function MentionSuggestions({
  id,
  rows,
  index,
  onHighlight,
  onAccept,
}: MentionSuggestionsProps) {
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (list.current?.children[index] as HTMLElement | undefined)?.scrollIntoView?.({
      block: "nearest",
    });
  }, [index]);

  return (
    <div
      ref={list}
      id={id}
      role="listbox"
      aria-label="Path suggestions"
      className={cn(
        "absolute top-full right-0 left-0 z-10 mt-1 max-h-48 overflow-y-auto",
        "rounded-md border border-border bg-popover py-1 text-popover-foreground shadow-overlay",
      )}
    >
      {rows.map((row, i) => (
        <div
          key={row.path}
          id={`${id}-${i}`}
          role="option"
          aria-selected={i === index}
          className={cn(
            "flex h-row cursor-pointer items-center gap-2 px-2.5 font-mono text-xs tracking-mono",
            i === index ? "bg-selected text-selected-foreground" : "hover:bg-hover",
          )}
          // `mousedown`, not `click`: click lands after blur, and blur closes
          // the list out from under the pointer.
          onMouseDown={(e) => {
            e.preventDefault();
            onAccept(row);
          }}
          onMouseEnter={() => onHighlight(i)}
        >
          {row.isDirectory ? (
            <Folder size={13} className="flex-none" />
          ) : (
            <File size={13} className="flex-none" />
          )}
          <span className="truncate">{row.label}</span>
        </div>
      ))}
    </div>
  );
}
