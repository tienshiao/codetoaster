import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Element } from "hast";
import { MermaidDiagram } from "./MermaidDiagram";
import { FrontmatterHeader } from "./FrontmatterHeader";
import type { Frontmatter } from "@/types/frontmatter";

/** Source text of a ```mermaid fence, given the hast node of its <pre>. */
function extractMermaidSource(node: Element | undefined): string | null {
  const child = node?.children[0];
  if (!child || child.type !== "element" || child.tagName !== "code") return null;
  const className = child.properties.className;
  if (!Array.isArray(className) || !className.includes("language-mermaid")) return null;
  const text = child.children[0];
  return text?.type === "text" ? text.value : null;
}

// Module-level constants, not inline literals: react-markdown renders <pre> with
// whatever component identity it is handed, so a fresh `components.pre` on every
// parent render makes React tear down and rebuild every code block. That wipes
// any text selection inside one — pressing ⌘ to copy re-renders FileContent
// (useModifierHeld) and the selection vanished before the C arrived.
const REMARK_PLUGINS = [remarkGfm];
const COMPONENTS: Components = {
  pre({ node, ...props }) {
    const mermaidSource = extractMermaidSource(node);
    if (mermaidSource !== null) return <MermaidDiagram source={mermaidSource} />;
    return <pre {...props} />;
  },
};

/**
 * Rendered markdown body, with the file's frontmatter above it when it has one.
 * Memoized on the source text so unrelated parent re-renders (modifier held,
 * scroll position) don't re-run the markdown pipeline or remount the mermaid
 * diagrams.
 *
 * The header lives inside the `markdown-preview` wrapper rather than beside it
 * (TASK-87): a nested value renders as a code block, and those rules are the
 * preview's.
 */
export const MarkdownPreview = memo(function MarkdownPreview({
  source,
  frontmatter,
}: {
  source: string;
  frontmatter?: Frontmatter;
}) {
  const body = (
    <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={COMPONENTS}>
      {source}
    </ReactMarkdown>
  );

  if (!frontmatter) {
    return <div className="markdown-preview max-w-3xl px-6 py-4 text-sm">{body}</div>;
  }

  // Padding moves onto the two children so the header's closing rule is the
  // only thing between them.
  return (
    <div className="markdown-preview text-sm">
      <FrontmatterHeader entries={frontmatter.entries} />
      <div className="max-w-3xl px-6 pb-4">{body}</div>
    </div>
  );
});
