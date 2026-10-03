import { test, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
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
