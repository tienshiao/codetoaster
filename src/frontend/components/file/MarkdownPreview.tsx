import {
  createContext,
  memo,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  type ComponentProps,
  type MouseEvent,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Element } from "hast";
import { MermaidDiagram } from "./MermaidDiagram";
import { FrontmatterHeader } from "./FrontmatterHeader";
import type { Frontmatter } from "@/types/frontmatter";
import { hrefKind } from "@/frontend/utils/markdown-links";

/** Source text of a ```mermaid fence, given the hast node of its <pre>. */
function extractMermaidSource(node: Element | undefined): string | null {
  const child = node?.children[0];
  if (!child || child.type !== "element" || child.tagName !== "code") return null;
  const className = child.properties.className;
  if (!Array.isArray(className) || !className.includes("language-mermaid")) return null;
  const text = child.children[0];
  return text?.type === "text" ? text.value : null;
}

/**
 * Who handles a click on a repository link. A context rather than a closure,
 * because the `a` component has to be a module-level constant (see below).
 */
const OpenLinkContext = createContext<(href: string) => void>(() => {});

/**
 * A link that stays out of the browser's hands unless it leaves the app
 * (TASK-122). Left alone, a relative `href` resolves against the app's own URL
 * and lands on a route that does not exist, and a bare fragment rewrites the
 * URL the router owns — so a fragment scrolls to its target here instead,
 * which is what GFM footnotes and their back-references need. The `href`
 * stays on the element so hovering still shows where it points.
 */
function MarkdownLink({ href, children, ...props }: ComponentProps<"a">) {
  const openLink = useContext(OpenLinkContext);
  const kind = href ? hrefKind(href) : "fragment";
  if (kind === "external") {
    return <a {...props} href={href} target="_blank" rel="noreferrer">{children}</a>;
  }
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    if (!href) return;
    if (kind === "file") {
      openLink(href);
      return;
    }
    // Scoped to this preview: another open file tab can carry the same ids.
    const id = decodeFragment(href.slice(1));
    const preview = e.currentTarget.closest(".markdown-preview");
    preview?.querySelector(`[id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "start" });
  };
  // A middle-click would open the app's 404 in a new browser tab.
  return (
    <a {...props} href={href} onClick={onClick} onAuxClick={(e) => e.preventDefault()}>
      {children}
    </a>
  );
}

function decodeFragment(fragment: string): string {
  try {
    return decodeURIComponent(fragment);
  } catch {
    return fragment;
  }
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
  a({ node: _node, ...props }) {
    return <MarkdownLink {...props} />;
  },
};

/**
 * Rendered markdown, with a handler for its repository links.
 *
 * `onOpenLink` receives a clicked link's raw `href`; resolving it is the
 * caller's, since only the caller has the file list. It is read through a ref
 * so a fresh callback each render does not defeat the body's memo.
 */
export function MarkdownPreview({
  source,
  frontmatter,
  onOpenLink,
}: {
  source: string;
  frontmatter?: Frontmatter;
  onOpenLink?: (href: string) => void;
}) {
  const onOpenLinkRef = useRef(onOpenLink);
  useLayoutEffect(() => {
    onOpenLinkRef.current = onOpenLink;
  });
  const openLink = useMemo(() => (href: string) => onOpenLinkRef.current?.(href), []);
  return (
    <OpenLinkContext.Provider value={openLink}>
      <MarkdownBody source={source} frontmatter={frontmatter} />
    </OpenLinkContext.Provider>
  );
}

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
const MarkdownBody = memo(function MarkdownBody({
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

  // An empty mapping (`---\n{}\n---`) parses, so a block can arrive with nothing
  // in it. `FrontmatterHeader` draws nothing for that, and taking the branch
  // below anyway would leave the body with the header's missing top padding.
  if (!frontmatter || frontmatter.entries.length === 0) {
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
