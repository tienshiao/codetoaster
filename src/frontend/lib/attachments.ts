/**
 * Attachments, as far as the prompt is concerned (TASK-93).
 *
 * A task is started by a string, so an attached file has to reach the agent as
 * a path inside it: Claude Code reads a file named in its opening turn, which
 * is the whole mechanism here — there is no attachment channel to use instead,
 * and inventing one would be a protocol only this UI speaks.
 */

/** Paths after the text, one per line, separated from it by a blank line.
 *
 * After, and never before, because `titleFromPrompt` takes the first non-empty
 * line: a prompt led by `/Users/tma/.codetoaster/uploads/…/screen.png` titles
 * the task with a path instead of the ask. A blank line so the paths read as
 * their own block rather than as the tail of the user's last sentence.
 *
 * Attachments with no text is a real submit — "look at this" is what dropping
 * a screenshot in and hitting ⌘⏎ means — and the paths are then the whole
 * prompt, with no leading blank line in front of them. */
export function promptWithAttachments(text: string, paths: string[]): string {
  const prompt = text.trim();
  if (paths.length === 0) return prompt;
  const block = paths.join("\n");
  return prompt ? `${prompt}\n\n${block}` : block;
}
