import { generateUUID } from "@/frontend/utils/uuid";

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

// The attachment itself, held here and not beside `AttachmentStrip` that
// draws it: the composer's draft store (TASK-112) owns the list now, and it is
// a `.ts` module under `bun test`, which must not import a React component
// module to get at a type and two helpers.

/** A file the composer is holding until submit (TASK-93). Nothing is uploaded
 * while it sits here, so this is the only copy of it — and `previewUrl` is an
 * object URL this module minted, which the holder has to release. */
export interface Attachment {
  id: string;
  file: File;
  /** A thumbnail source, for an image. Undefined for everything else, which
   * gets an icon rather than a broken picture. */
  previewUrl?: string;
}

export function toAttachment(file: File): Attachment {
  return {
    // Not `crypto.randomUUID`: it is undefined on an insecure origin, which is
    // exactly how this UI is reached over plain http on a LAN.
    id: generateUUID(),
    file,
    // Only for an image. A PDF or a log would render as a broken thumbnail,
    // and an object URL for one is a leak with nothing to show for it.
    previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined,
  };
}

/** The other half of `toAttachment`. An object URL pins its blob in memory for
 * the life of the document, so a composer the user pastes ten screenshots into
 * and then clears keeps all ten until the tab closes. */
export function releaseAttachment(attachment: Attachment): void {
  if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
}
