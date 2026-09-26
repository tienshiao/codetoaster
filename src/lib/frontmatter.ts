// Finding a YAML frontmatter block in a markdown file. One copy, shared by the
// Backlog reader and the file-content serializer (TASK-87): if the two ever
// disagreed about where a block ends, the preview would either show a line of
// raw YAML or eat a line of body.

export interface FrontmatterBlock {
  /** The YAML between the fences, the fences themselves excluded. */
  yaml: string;
  /** Source lines the block spans, *both* fences included — what a caller drops
   * off the front of the body it renders. */
  lineCount: number;
  /** Everything after the closing fence, as written (line endings included).
   * Handed over rather than left to the caller to re-split: a caller counting
   * `lineCount` lines off its own split of the text has to split exactly as
   * this did, and the day the two disagree the body starts on the wrong line
   * with nothing to say so. */
  body: string;
}

export function extractFrontmatter(text: string): FrontmatterBlock | null {
  // A byte-order mark ahead of the opening `---` would otherwise read as "no
  // frontmatter" and silently drop the task.
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const lines = body.split("\n");
  if (lines[0]?.trim() !== "---") return null;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === "---") {
      return {
        yaml: lines.slice(1, i).join("\n"),
        lineCount: i + 1,
        body: lines.slice(i + 1).join("\n"),
      };
    }
  }
  return null;
}
