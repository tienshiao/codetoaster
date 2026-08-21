// Session names are derived rather than random. A session is born with a
// provisional "<dir> · <branch>" label, then latches onto the first terminal
// title (OSC 0/2) that carries real information — the titles Claude Code, vim,
// ssh and friends set deliberately. Latching is permanent: a name that keeps
// changing under you is as hard to remember as a random one. A manual rename
// opts out of derivation entirely.
//
// Kept free of imports so the frontend can share the redundancy check without
// pulling node builtins into the bundle; the filesystem and git lookups that
// feed formatProvisionalName live in session-manager.

// Where a session's current name came from. "provisional" is the derived
// "<dir> · <branch>" label and is the only state a terminal title will still
// replace; "latched" and "manual" are both terminal.
export type NameSource = "provisional" | "latched" | "manual";

const MAX_NAME_LENGTH = 60;
const NAME_SEPARATOR = " · ";

// Leading tokens that are decoration rather than content. fish's default
// fish_title is "<current-command> <pwd>", so an idle prompt reports
// "fish ~/P/codetoaster"; dropping the shell leaves a bare path, which the
// path filter then rejects.
const SHELL_NAMES = new Set([
  "bash", "csh", "dash", "fish", "ksh", "login", "nu", "pwsh",
  "screen", "sh", "tcsh", "tmux", "xonsh", "zsh",
]);

// "tma@laptop" / "tma@laptop.local" — the other half of a default shell title.
const USER_AT_HOST_RE = /^[\w.-]+@[\w.-]+$/;

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

function isPathLike(token: string): boolean {
  return token.startsWith("~") || token.includes("/");
}

// Collapse a raw title to comparable content: control characters and the
// decorative glyphs TUIs prefix (Claude Code's "✳", spinner frames) carry no
// meaning, and a leading shell name is boilerplate.
export function stripDecoration(rawTitle: string): string {
  const normalized = rawTitle
    .replace(/\p{Cc}/gu, " ")
    .replace(/^[^\p{L}\p{N}~/.]+/u, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "";

  const tokens = normalized.split(" ");
  if (tokens.length > 1 && SHELL_NAMES.has(tokens[0]!.replace(/^-/, "").toLowerCase())) {
    return tokens.slice(1).join(" ");
  }
  return normalized;
}

// The name a title would latch to, or null if the title says nothing a
// provisional name doesn't already say.
export function deriveTitleName(rawTitle: string, provisionalName?: string): string | null {
  const stripped = stripDecoration(rawTitle);
  if (!stripped) return null;

  // Judge on content words only: paths and user@host are what shells emit by
  // default, so a title made entirely of them is the shell talking, not a
  // program describing its work.
  const content = stripped.split(" ").filter((token) => {
    const bare = token.replace(/[:,]+$/, "");
    return bare.length > 0 && !USER_AT_HOST_RE.test(bare) && !isPathLike(bare);
  });

  // Two words minimum. A bare program name ("claude", "vim") is what the shell
  // reports the instant a command starts; holding out for a second word is
  // what lets the latch land on "foo.ts (~/x) - VIM" instead of "vim", and on
  // a Claude Code task description instead of "claude".
  if (content.length < 2) return null;

  const name = truncate(stripped, MAX_NAME_LENGTH);
  if (provisionalName && name.toLowerCase() === provisionalName.toLowerCase()) return null;
  return name;
}

// Whether a title is worth showing alongside a name. False once a name has
// latched onto that same title, so the sidebar doesn't print it twice.
export function titleAddsInfo(name: string, rawTitle: string): boolean {
  const stripped = stripDecoration(rawTitle);
  if (!stripped) return false;
  return truncate(stripped, MAX_NAME_LENGTH).toLowerCase() !== name.toLowerCase();
}

export function formatProvisionalName(dirLabel: string | undefined, branch?: string): string {
  const base = dirLabel || "Shell";
  return branch ? `${base}${NAME_SEPARATOR}${branch}` : base;
}

// Sessions in the same repo and branch would otherwise collide, and two
// identically-named tabs are exactly the problem derived names are meant to fix.
export function uniqueName(base: string, existing: Iterable<string>): string {
  const taken = new Set(existing);
  if (!taken.has(base)) return base;
  let suffix = 2;
  while (taken.has(`${base} ${suffix}`)) suffix++;
  return `${base} ${suffix}`;
}
