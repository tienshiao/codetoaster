import {
  createContext,
  memo,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type MouseEvent,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Element as HastElement, ElementContent, Root } from "hast";
import { MermaidDiagram } from "./MermaidDiagram";
import { FrontmatterHeader } from "./FrontmatterHeader";
import type { Frontmatter } from "@/types/frontmatter";
import { anchorKey, createSlugger, decode, hrefKind } from "@/frontend/utils/markdown-links";

/** Source text of a ```mermaid fence, given the hast node of its <pre>. */
function extractMermaidSource(node: HastElement | undefined): string | null {
  const child = node?.children[0];
  if (!child || child.type !== "element" || child.tagName !== "code") return null;
  const className = child.properties.className;
  if (!Array.isArray(className) || !className.includes("language-mermaid")) return null;
  const text = child.children[0];
  return text?.type === "text" ? text.value : null;
}

/** A request to scroll the preview to a heading. `seq` changes on every
 * request, so asking for the same heading twice scrolls twice. */
export interface AnchorJump {
  anchor: string;
  seq: number;
}

/**
 * What the preview needs from its caller, who alone has the file list. A
 * context rather than a closure, because the `a` and `img` components have
 * to be module-level constants (see below).
 */
interface PreviewHandlers {
  /** A repository link was clicked, by its raw `href`. */
  onOpenLink?: (href: string) => void;
  /** The URL to load a repository image from, or null for none (TASK-125). */
  resolveImage?: (src: string) => Promise<string | null>;
}

const PreviewContext = createContext<PreviewHandlers>({});

const HEADINGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
const ID_PREFIX = "user-content-";

function textOf(nodes: ElementContent[]): string {
  return nodes.map((n) => (n.type === "text" ? n.value : n.type === "element" ? textOf(n.children) : "")).join("");
}

function elements(node: Root | HastElement): HastElement[] {
  return node.children.flatMap((child) => (child.type === "element" ? [child, ...elements(child)] : []));
}

/**
 * Gives every heading an id (TASK-124), so a `#setup` link has somewhere to
 * land. The slug is GitHub's, repeats numbered as GitHub numbers them, and
 * the id carries the same `user-content-` prefix react-markdown gives
 * footnotes, so a heading called "Root" cannot collide with the app's own
 * element ids. The footnotes' ids are reserved first, so no heading takes
 * one. `findAnchor` looks through the prefix.
 */
function rehypeHeadingIds() {
  return (tree: Root) => {
    const all = elements(tree);
    const taken = all.flatMap((el) => {
      const id = el.properties.id;
      return typeof id === "string" && id.startsWith(ID_PREFIX) ? [id.slice(ID_PREFIX.length)] : [];
    });
    const slug = createSlugger(taken);
    for (const el of all) {
      if (HEADINGS.has(el.tagName) && el.properties.id === undefined) {
        el.properties.id = `${ID_PREFIX}${slug(textOf(el.children))}`;
      }
    }
  };
}

/**
 * The element a fragment names inside `container`. Exact ids first — a heading
 * by its prefixed id, a footnote by the prefixed href it already carries — and
 * then any heading whose id agrees on `anchorKey`, which is how a Bitbucket
 * `#markdown-header-…` or a hand-written fragment finds its heading.
 */
function findAnchor(container: ParentNode, fragment: string): Element | null {
  const byId = (id: string) => container.querySelector(`[id="${CSS.escape(id)}"]`);
  const exact = byId(`${ID_PREFIX}${fragment}`) ?? byId(fragment);
  if (exact) return exact;
  const key = anchorKey(fragment);
  if (!key) return null;
  const headings = container.querySelectorAll("h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]");
  return Array.from(headings).find((h) => anchorKey(h.id) === key) ?? null;
}

function scrollToAnchor(container: ParentNode | null, fragment: string): void {
  if (container) findAnchor(container, fragment)?.scrollIntoView({ block: "start" });
}

/** How long a jump keeps its heading in place while the page settles. */
const PIN_MS = 3000;
/** Anything the user does to move the page ends the pin at once. */
const RELEASE_EVENTS = ["wheel", "touchstart", "pointerdown", "keydown"] as const;

/**
 * Keeps `target` at the top while content above it is still arriving.
 * Repository images get their `src` only once the file list answers, and
 * mermaid renders asynchronously, so both grow after the jump has scrolled and
 * would push the heading off screen. Each resize of the preview scrolls it back
 * — until the user scrolls, clicks or types, or `PIN_MS` passes. Returns the
 * release, for the effect's cleanup.
 */
function pinWhileLayoutSettles(container: HTMLElement, target: Element): () => void {
  if (typeof ResizeObserver === "undefined") return () => {};
  const observer = new ResizeObserver(() => target.scrollIntoView({ block: "start" }));
  observer.observe(container);
  const release = () => {
    observer.disconnect();
    clearTimeout(timer);
    for (const type of RELEASE_EVENTS) window.removeEventListener(type, release, true);
  };
  const timer = setTimeout(release, PIN_MS);
  for (const type of RELEASE_EVENTS) window.addEventListener(type, release, true);
  return release;
}

/**
 * A link that stays out of the browser's hands unless it leaves the app
 * (TASK-122). Left alone, a relative `href` resolves against the app's own URL
 * and lands on a route that does not exist, and a bare fragment rewrites the
 * URL the router owns — so a fragment scrolls to its target here instead:
 * a heading, or a GFM footnote and its back-reference. The `href` stays on
 * the element so hovering still shows where it points.
 */
function MarkdownLink({ href, children, ...props }: ComponentProps<"a">) {
  const { onOpenLink } = useContext(PreviewContext);
  const kind = href ? hrefKind(href) : "fragment";
  if (kind === "external") {
    return <a {...props} href={href} target="_blank" rel="noreferrer">{children}</a>;
  }
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    if (!href) return;
    if (kind === "file") {
      onOpenLink?.(href);
      return;
    }
    // Scoped to this preview: another open file tab can carry the same ids.
    scrollToAnchor(e.currentTarget.closest(".markdown-preview"), decode(href.slice(1)));
  };
  // A middle-click would open the app's 404 in a new browser tab.
  return (
    <a {...props} href={href} onClick={onClick} onAuxClick={(e) => e.preventDefault()}>
      {children}
    </a>
  );
}

/**
 * An image whose source is a repository path (TASK-125). Like a link, a
 * relative `src` would otherwise resolve against the app's URL and break, so
 * the caller turns it into a URL for the file. Nothing is requested until it
 * answers, and with no one to ask the image shows its alt text rather than a
 * request bound to fail. External sources load as they are.
 */
function MarkdownImage({ src, alt, ...props }: ComponentProps<"img">) {
  const { resolveImage } = useContext(PreviewContext);
  const local = typeof src === "string" && src !== "" && hrefKind(src) === "file" ? src : null;
  const [resolved, setResolved] = useState<{ src: string; url: string | null } | null>(null);

  useEffect(() => {
    if (!local || !resolveImage) return;
    let live = true;
    resolveImage(local).then(
      (url) => live && setResolved({ src: local, url }),
      () => live && setResolved({ src: local, url: null }),
    );
    return () => {
      live = false;
    };
  }, [local, resolveImage]);

  if (local === null) return <img {...props} src={src} alt={alt} />;
  const url = resolved?.src === local ? resolved.url : null;
  return <img {...props} src={url ?? undefined} alt={alt} />;
}

// Module-level constants, not inline literals: react-markdown renders <pre> with
// whatever component identity it is handed, so a fresh `components.pre` on every
// parent render makes React tear down and rebuild every code block. That wipes
// any text selection inside one — pressing ⌘ to copy re-renders FileContent
// (useModifierHeld) and the selection vanished before the C arrived.
const REMARK_PLUGINS = [remarkGfm];
const REHYPE_PLUGINS = [rehypeHeadingIds];
const COMPONENTS: Components = {
  pre({ node, ...props }) {
    const mermaidSource = extractMermaidSource(node);
    if (mermaidSource !== null) return <MermaidDiagram source={mermaidSource} />;
    return <pre {...props} />;
  },
  a({ node: _node, ...props }) {
    return <MarkdownLink {...props} />;
  },
  img({ node: _node, ...props }) {
    return <MarkdownImage {...props} />;
  },
};

/**
 * Rendered markdown, with handlers for its repository links and images.
 *
 * Resolving either is the caller's, since only the caller has the file list.
 * New callbacks each render cost only the links' and images' re-render:
 * context reaches its consumers past the body's memo, so the markdown
 * pipeline does not run again. `resolveImage` should still be stable, since
 * an image asks again whenever it changes.
 *
 * `jump` scrolls to a heading once per `seq` — how a link from another file
 * lands on its section.
 */
export function MarkdownPreview({
  source,
  frontmatter,
  onOpenLink,
  resolveImage,
  jump,
  onJumped,
}: {
  source: string;
  frontmatter?: Frontmatter;
  onOpenLink?: (href: string) => void;
  resolveImage?: (src: string) => Promise<string | null>;
  jump?: AnchorJump | null;
  /** The jump with this `seq` has been served and should not be asked for
   * again; `landed` says whether its heading was there to scroll to. */
  onJumped?: (seq: number, landed: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onJumpedRef = useRef(onJumped);
  useLayoutEffect(() => {
    onJumpedRef.current = onJumped;
  });

  // The jump served by this mount, and the pin it left. Neither follows the
  // `jump` prop once served: the caller stops asking as soon as `onJumped`
  // has recorded the request, and that re-render must not cut the pin short.
  // Both are reset when the preview unmounts — which includes StrictMode's
  // rehearsal unmount, so the remount that follows serves the jump again
  // rather than finding it already marked done with its pin released.
  const servedSeq = useRef<number | null>(null);
  const releasePin = useRef<(() => void) | null>(null);
  useLayoutEffect(
    () => () => {
      releasePin.current?.();
      releasePin.current = null;
      servedSeq.current = null;
    },
    [],
  );

  const seq = jump?.seq;
  const anchor = jump?.anchor;
  useLayoutEffect(() => {
    if (seq === undefined || anchor === undefined || servedSeq.current === seq) return;
    servedSeq.current = seq;
    releasePin.current?.();
    releasePin.current = null;
    const container = ref.current;
    const target = container && findAnchor(container, anchor);
    if (container && target) {
      target.scrollIntoView({ block: "start" });
      releasePin.current = pinWhileLayoutSettles(container, target);
    }
    onJumpedRef.current?.(seq, target !== null);
  }, [seq, anchor]);

  const handlers = useMemo(() => ({ onOpenLink, resolveImage }), [onOpenLink, resolveImage]);

  return (
    <PreviewContext.Provider value={handlers}>
      <div ref={ref}>
        <MarkdownBody source={source} frontmatter={frontmatter} />
      </div>
    </PreviewContext.Provider>
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
    <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS} components={COMPONENTS}>
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
