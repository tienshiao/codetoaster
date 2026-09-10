/**
 * The `@path` token in the composer's prompt: where it starts, what has been
 * typed of it, and what accepting a suggestion writes back (TASK-100).
 *
 * Apart from the component that uses it so `bun test` can reach it without a
 * DOM — the same split `path-suggest.ts` and `drag.ts` make. Everything here is
 * arithmetic over a string and a caret; nothing knows about fetching, and the
 * hook that does knows nothing about counting characters.
 */

export interface Mention {
  /** Index of the `@`. */
  start: number;
  /** End of the whole token — the next whitespace, or the end of the text. */
  end: number;
  /** What has been typed between the `@` and the caret. */
  query: string;
}

function isSpace(ch: string | undefined): boolean {
  return ch === undefined || /\s/.test(ch);
}

/**
 * The mention the caret is inside, or null.
 *
 * The `@` has to be at a word start — index 0, or right after whitespace — so
 * `foo@bar.com` and `a@b` are addresses and code, not completions. Nothing
 * between it and the caret may be whitespace either: a caret two words along
 * from an `@` is no longer in that token.
 *
 * `end` runs past the caret to the end of the token rather than stopping at it,
 * because accepting from the middle of `@src/pars|er.ts` has to replace the
 * whole path and not leave "er.ts" trailing behind the insert. `query` is only
 * the part before the caret — the prefix the user has actually committed to,
 * which is what makes editing an existing token re-query on what is to its
 * left.
 */
export function findMention(text: string, caret: number): Mention | null {
  const at = Math.max(0, Math.min(caret, text.length));

  let start = -1;
  for (let i = at - 1; i >= 0; i--) {
    const ch = text[i]!;
    if (/\s/.test(ch)) return null;
    if (ch === "@") {
      start = i;
      break;
    }
  }
  if (start === -1) return null;
  // At a word start, or it is part of something else that happens to contain an
  // `@` — an email address being the case that matters.
  if (start > 0 && !isSpace(text[start - 1])) return null;

  let end = at;
  while (end < text.length && !/\s/.test(text[end]!)) end++;

  return { start, end, query: text.slice(start + 1, at) };
}

/** Whether the query names a filesystem path rather than a project-relative
 * one. `~` is left as it is: the server expands it, and the token the user ends
 * up with is the one they would have typed. */
export function isAbsoluteQuery(query: string): boolean {
  return query.startsWith("/") || query.startsWith("~");
}

/**
 * The prompt with the mention's token replaced by `@path`, and where the caret
 * goes.
 *
 * A file ends the token with a space: it is finished, and the next word is
 * prose again. A directory ends with `/`, which is both what the next request
 * needs to list *inside* it and what leaves the token still open — so Enter
 * again drills one level down.
 *
 * The `@` stays. It is what lets the caret come back into the token later and
 * re-open the list on the prefix, rather than the whole path having to be
 * deleted and retyped.
 */
export function applyMention(
  text: string,
  mention: Mention,
  path: string,
  kind: "file" | "directory",
): { text: string; caret: number } {
  const inserted = "@" + path + (kind === "directory" ? "/" : " ");
  return {
    text: text.slice(0, mention.start) + inserted + text.slice(mention.end),
    caret: mention.start + inserted.length,
  };
}
