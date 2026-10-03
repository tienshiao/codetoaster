import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { MarkdownPreview } from "./MarkdownPreview";

/**
 * Links in the preview (TASK-122): a repository link is handed to the caller
 * instead of being followed, since the browser would resolve it against the
 * app's own URL. What it resolves to is `markdown-links.test.ts`'s business.
 */
const SOURCE = [
  "[Archive](services/archive.md)",
  "[Spec](LED%20API%203#markdown-header-x)",
  "[Site](https://example.com)",
  "[Below](#logging)",
].join("\n\n");

test("a repository link is handed over, not followed", () => {
  const onOpenLink = vi.fn();
  render(<MarkdownPreview source={SOURCE} onOpenLink={onOpenLink} />);

  const link = screen.getByRole("link", { name: "Archive" });
  // fireEvent returns false when the default was prevented.
  expect(fireEvent.click(link)).toBe(false);
  expect(onOpenLink).toHaveBeenCalledWith("services/archive.md");

  fireEvent.click(screen.getByRole("link", { name: "Spec" }));
  expect(onOpenLink).toHaveBeenLastCalledWith("LED%20API%203#markdown-header-x");
});

test("an external link opens in a new browser tab and is not handed over", () => {
  const onOpenLink = vi.fn();
  render(<MarkdownPreview source={SOURCE} onOpenLink={onOpenLink} />);

  const link = screen.getByRole("link", { name: "Site" });
  expect(link.getAttribute("target")).toBe("_blank");
  expect(link.getAttribute("rel")).toBe("noreferrer");
  expect(fireEvent.click(link)).toBe(true);
  expect(onOpenLink).not.toHaveBeenCalled();
});

test("a fragment-only link leaves the app URL alone", () => {
  const onOpenLink = vi.fn();
  render(<MarkdownPreview source={SOURCE} onOpenLink={onOpenLink} />);

  expect(fireEvent.click(screen.getByRole("link", { name: "Below" }))).toBe(false);
  expect(onOpenLink).not.toHaveBeenCalled();
});

test("a footnote link scrolls to its note", () => {
  const scrolled: Element[] = [];
  const original = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this);
  };
  try {
    const { container } = render(<MarkdownPreview source={"Claim.[^1]\n\n[^1]: The note."} />);
    const ref = container.querySelector<HTMLAnchorElement>('a[href^="#"][data-footnote-ref]')!;
    fireEvent.click(ref);
    expect(scrolled).toHaveLength(1);
    expect(scrolled[0]!.id).toBe(ref.getAttribute("href")!.slice(1));
  } finally {
    Element.prototype.scrollIntoView = original;
  }
});

test("a click reaches the latest handler after a re-render", () => {
  const first = vi.fn();
  const second = vi.fn();
  const { rerender } = render(<MarkdownPreview source={SOURCE} onOpenLink={first} />);
  rerender(<MarkdownPreview source={SOURCE} onOpenLink={second} />);

  fireEvent.click(screen.getByRole("link", { name: "Archive" }));
  expect(first).not.toHaveBeenCalled();
  expect(second).toHaveBeenCalledWith("services/archive.md");
});

/**
 * Headings (TASK-124). Happy DOM has no layout, so a scroll is observed by
 * which element `scrollIntoView` was called on.
 */
const scrolled: Element[] = [];
const originalScrollIntoView = Element.prototype.scrollIntoView;
beforeEach(() => {
  scrolled.length = 0;
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this);
  };
});
afterEach(() => {
  Element.prototype.scrollIntoView = originalScrollIntoView;
});

const DOC = [
  "[To setup](#setup) [To LED](#markdown-header-led-api-2) [To second](#setup-1)",
  "# Setup",
  "## LED API 2",
  "## Color (array) subsets",
  "# Setup",
].join("\n\n");

test("headings get prefixed GitHub slugs, repeats numbered", () => {
  const { container } = render(<MarkdownPreview source={DOC} />);
  expect(Array.from(container.querySelectorAll("h1, h2"), (h) => h.id)).toEqual([
    "user-content-setup",
    "user-content-led-api-2",
    "user-content-color-array-subsets",
    "user-content-setup-1",
  ]);
});

test("an in-page heading link scrolls to its heading", () => {
  const { container } = render(<MarkdownPreview source={DOC} />);
  fireEvent.click(screen.getByRole("link", { name: "To setup" }));
  expect(scrolled).toEqual([container.querySelector("#user-content-setup")]);

  fireEvent.click(screen.getByRole("link", { name: "To second" }));
  expect(scrolled.at(-1)).toBe(container.querySelector("#user-content-setup-1"));
});

test("a Bitbucket markdown-header- fragment finds the same heading", () => {
  const { container } = render(<MarkdownPreview source={DOC} />);
  fireEvent.click(screen.getByRole("link", { name: "To LED" }));
  expect(scrolled).toEqual([container.querySelector("#user-content-led-api-2")]);
});

test("a jump scrolls on mount and once per seq", () => {
  const { container, rerender } = render(
    <MarkdownPreview source={DOC} jump={{ anchor: "markdown-header-color-array-subsets", seq: 1 }} />,
  );
  const heading = container.querySelector("#user-content-color-array-subsets");
  expect(scrolled).toEqual([heading]);

  // Same request re-rendered: no second scroll.
  rerender(<MarkdownPreview source={DOC} jump={{ anchor: "markdown-header-color-array-subsets", seq: 1 }} />);
  expect(scrolled).toHaveLength(1);

  // The same heading asked for again: scrolls again.
  rerender(<MarkdownPreview source={DOC} jump={{ anchor: "markdown-header-color-array-subsets", seq: 2 }} />);
  expect(scrolled).toEqual([heading, heading]);
});

test("a jump to a heading that is not there scrolls nothing, and is still reported done", () => {
  const onJumped = vi.fn();
  render(<MarkdownPreview source={DOC} jump={{ anchor: "nowhere", seq: 7 }} onJumped={onJumped} />);
  expect(scrolled).toEqual([]);
  expect(onJumped).toHaveBeenCalledWith(7, false);
});

test("ids are numbered past ones already taken", () => {
  const { container } = render(<MarkdownPreview source={"# A\n\n# A-1\n\n# A"} />);
  expect(Array.from(container.querySelectorAll("h1"), (h) => h.id)).toEqual([
    "user-content-a",
    "user-content-a-1",
    "user-content-a-2",
  ]);
});

test("a heading cannot take a footnote's id", () => {
  const { container } = render(<MarkdownPreview source={"Claim.[^1]\n\n## fn 1\n\n[^1]: The note."} />);
  const heading = container.querySelector("h2:not(.sr-only)")!;
  expect(heading.id).not.toBe("user-content-fn-1");
  fireEvent.click(container.querySelector('a[data-footnote-ref]')!);
  expect(scrolled).toHaveLength(1);
  expect(scrolled[0]!.tagName).toBe("LI");
});

/** A ResizeObserver the test can fire by hand; `onResize` is unset once the
 * pin disconnects. Happy DOM has no layout to resize. */
let onResize: (() => void) | undefined;
const OriginalResizeObserver = globalThis.ResizeObserver;
function stubResizeObserver() {
  globalThis.ResizeObserver = class {
    constructor(callback: () => void) {
      onResize = callback;
    }
    observe() {}
    unobserve() {}
    disconnect() {
      onResize = undefined;
    }
  } as unknown as typeof ResizeObserver;
}
afterEach(() => {
  globalThis.ResizeObserver = OriginalResizeObserver;
  onResize = undefined;
});

test("after a jump the heading is held in place while the page grows, until the user moves it", () => {
  stubResizeObserver();
  const { container } = render(<MarkdownPreview source={DOC} jump={{ anchor: "setup-1", seq: 1 }} />);
  const heading = container.querySelector("#user-content-setup-1");
  expect(scrolled).toEqual([heading]);

  // An image above it loads: scrolled back to the heading.
  onResize?.();
  expect(scrolled).toEqual([heading, heading]);

  // The user scrolls: the pin lets go.
  fireEvent.wheel(window);
  expect(onResize).toBeUndefined();
});

test("the pin outlasts the caller's ceasing to ask for the jump", () => {
  // The caller records the request as served and re-renders with no jump at
  // all; that must not cut the pin short.
  stubResizeObserver();
  const { container, rerender } = render(<MarkdownPreview source={DOC} jump={{ anchor: "setup-1", seq: 1 }} />);
  rerender(<MarkdownPreview source={DOC} jump={null} />);
  onResize?.();
  const heading = container.querySelector("#user-content-setup-1");
  expect(scrolled).toEqual([heading, heading]);
});

test("under StrictMode the jump is served and pinned all the same", () => {
  stubResizeObserver();
  const { container } = render(
    <StrictMode>
      <MarkdownPreview source={DOC} jump={{ anchor: "setup-1", seq: 1 }} />
    </StrictMode>,
  );
  expect(onResize).toBeDefined();
  onResize?.();
  expect(scrolled.at(-1)).toBe(container.querySelector("#user-content-setup-1"));
});

/** Images (TASK-125). */
const IMAGES = "![local](diagrams/arch.png) ![remote](https://example.com/a.png)";

test("a repository image loads from what the caller resolves it to", async () => {
  const resolveImage = vi.fn(async (src: string) => `/api/image?file=${encodeURIComponent(`docs/${src}`)}`);
  render(<MarkdownPreview source={IMAGES} resolveImage={resolveImage} />);

  const local = screen.getByAltText("local");
  await waitFor(() => expect(local.getAttribute("src")).toBe("/api/image?file=docs%2Fdiagrams%2Farch.png"));
  expect(resolveImage).toHaveBeenCalledWith("diagrams/arch.png");
  expect(resolveImage).toHaveBeenCalledTimes(1);
});

test("an external image is left alone and never resolved", () => {
  const resolveImage = vi.fn(async () => "/nope");
  render(<MarkdownPreview source={IMAGES} resolveImage={resolveImage} />);
  expect(screen.getByAltText("remote").getAttribute("src")).toBe("https://example.com/a.png");
  expect(resolveImage).not.toHaveBeenCalledWith("https://example.com/a.png");
});

test("with no one to resolve it, a repository image requests nothing", () => {
  render(<MarkdownPreview source={IMAGES} />);
  expect(screen.getByAltText("local").hasAttribute("src")).toBe(false);
});

test("an image that resolves to nothing requests nothing", async () => {
  const resolveImage = vi.fn(async () => null);
  render(<MarkdownPreview source={IMAGES} resolveImage={resolveImage} />);
  await waitFor(() => expect(resolveImage).toHaveBeenCalled());
  expect(screen.getByAltText("local").hasAttribute("src")).toBe(false);
});
