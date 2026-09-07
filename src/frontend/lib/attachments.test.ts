import { test, expect, describe } from "bun:test";
import { promptWithAttachments } from "./attachments";

describe("promptWithAttachments", () => {
  test("appends the paths under the text, so the title still comes off the ask", () => {
    expect(promptWithAttachments("Fix the header", ["/u/a.png", "/u/b.log"])).toBe(
      "Fix the header\n\n/u/a.png\n/u/b.log",
    );
  });

  test("is the text alone when nothing is attached", () => {
    expect(promptWithAttachments("  Fix the header  ", [])).toBe("Fix the header");
  });

  test("is the paths alone when there is no text", () => {
    expect(promptWithAttachments("   ", ["/u/a.png"])).toBe("/u/a.png");
  });
});
