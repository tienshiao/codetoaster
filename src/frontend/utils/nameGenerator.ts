export const ADJECTIVES = [
  "Agile", "Bold", "Brave", "Bright", "Calm",
  "Clever", "Cool", "Daring", "Eager", "Epic",
  "Fair", "Fast", "Fierce", "Fond", "Gallant",
  "Gentle", "Grand", "Happy", "Hardy", "Hazy",
  "Jolly", "Keen", "Kind", "Lively", "Lucky",
  "Merry", "Modest", "Noble", "Pensive", "Plucky",
  "Proud", "Quick", "Quiet", "Sharp", "Sleek",
  "Smart", "Snappy", "Steady", "Stoic", "Swift",
  "Tender", "Thrifty", "Tidy", "Trusty", "Vivid",
  "Warm", "Wise", "Witty", "Zealous", "Zesty",
];

export const SCIENTISTS = [
  "Babbage", "Boole", "Cerf", "Chomsky", "Church",
  "Conway", "Curie", "Darwin", "Dijkstra", "Einstein",
  "Euler", "Feynman", "Gauss", "Godel", "Hawking",
  "Hilbert", "Hopper", "Hypatia", "Karp", "Knuth",
  "Lamarr", "Leibniz", "Lovelace", "Mandelbrot", "Maxwell",
  "Minsky", "Nash", "Neumann", "Newton", "Noether",
  "Pascal", "Planck", "Poincare", "Ramanujan", "Ritchie",
  "Rivest", "Rosalind", "Shannon", "Stallman", "Tesla",
  "Thompson", "Torvalds", "Turing", "Wiles", "Wirth",
  "Wozniak", "Yao", "Zuse",
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

export function generateSessionName(existingNames: string[]): string {
  const existing = new Set(existingNames);
  const maxAttempts = 50;

  for (let i = 0; i < maxAttempts; i++) {
    const name = `${pick(ADJECTIVES)} ${pick(SCIENTISTS)}`;
    if (!existing.has(name)) return name;
  }

  // Fallback: append a number suffix
  const base = `${pick(ADJECTIVES)} ${pick(SCIENTISTS)}`;
  let suffix = 2;
  while (existing.has(`${base} ${suffix}`)) suffix++;
  return `${base} ${suffix}`;
}
