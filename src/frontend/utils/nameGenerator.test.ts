import { test, expect, describe } from "bun:test";
import { generateSessionName, ADJECTIVES, SCIENTISTS } from "./nameGenerator";

describe("generateSessionName", () => {
  test("returns a two-word title-case name", () => {
    const name = generateSessionName([]);
    const parts = name.split(" ");
    expect(parts.length).toBe(2);
    // Each word should be title case (first char uppercase)
    for (const word of parts) {
      expect(word[0]).toBe(word[0]!.toUpperCase());
    }
  });

  test("returns unique names across multiple calls", () => {
    // Independent draws so a broken RNG (always the same combo) still fails,
    // with slack for birthday-paradox collisions: 20 draws from ~2400 combos
    // collide ~8% of the time, but 6+ collisions is ~1e-10.
    const names = new Set<string>();
    for (let i = 0; i < 20; i++) {
      names.add(generateSessionName([]));
    }
    expect(names.size).toBeGreaterThanOrEqual(15);
  });

  test("avoids collisions with existing names", () => {
    const existing = ["Bold Turing", "Calm Knuth"];
    const name = generateSessionName(existing);
    expect(existing).not.toContain(name);
  });

  test("falls back to numbered suffix when all combos are taken", () => {
    // Exhaust every adjective+scientist combination
    const allCombos: string[] = [];
    for (const adj of ADJECTIVES) {
      for (const sci of SCIENTISTS) {
        allCombos.push(`${adj} ${sci}`);
      }
    }
    const name = generateSessionName(allCombos);
    // Should have a numeric suffix like "Bold Turing 2"
    expect(name).toMatch(/^[A-Z]\w+ [A-Z]\w+ \d+$/);
    expect(allCombos).not.toContain(name);
  });
});
