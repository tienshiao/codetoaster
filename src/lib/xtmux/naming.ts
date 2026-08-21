// A session shows the most specific thing known about it at any moment, in
// this order: an explicit rename, else the terminal's own title (OSC 0/2) when
// that title says something, else a derived "<dir> · <branch>" label.
//
// Nothing is frozen. The title is live, so a session follows its program from
// "Claude Code" to whatever task that program is describing, and falls back to
// the derived label when the title goes quiet again. That live projection is
// what keeps sessions distinguishable — an earlier design latched the name onto
// the first usable title, which meant every Claude Code session froze on the
// generic startup title before any task existed.
//
// The two are kept apart on purpose. `name` is stable identity: it is what the
// URL slug and the CLI's name matching are built from, so it must not churn
// every time a program repaints its title. The display label is derived at
// render time and never stored.
//
// Kept free of imports so the frontend can share the projection without pulling
// node builtins into the bundle; the filesystem and git lookups that feed
// formatDerivedName live in session-manager.

// Where a session's stored `name` came from. "manual" is a deliberate rename
// and outranks the terminal title; "derived" is the "<dir> · <branch>" label
// and yields to any title that carries real content.
export type NameSource = "derived" | "manual";

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

// The label a title is worth showing as, or null if it says less than the
// derived name already does.
export function meaningfulTitle(rawTitle: string | undefined): string | null {
  if (!rawTitle) return null;
  const stripped = stripDecoration(rawTitle);
  if (!stripped) return null;

  // Judge on content words only: paths and user@host are what shells emit by
  // default, so a title made entirely of them is the shell talking, not a
  // program describing its work.
  const content = stripped.split(" ").filter((token) => {
    const bare = token.replace(/[:,]+$/, "");
    return bare.length > 0 && !USER_AT_HOST_RE.test(bare) && !isPathLike(bare);
  });

  // Two words minimum. A bare program name ("vim", "node") is what the shell
  // reports the instant a command starts, and says strictly less than the
  // directory and branch the derived name already carries.
  if (content.length < 2) return null;

  return truncate(stripped, MAX_NAME_LENGTH);
}

// What to show for a session, at render time. An explicit rename outranks the
// title — having renamed a session, you should not watch the name you chose
// get painted over by whatever the program inside is doing.
export function sessionDisplayName(session: {
  name: string;
  nameSource?: NameSource;
  title?: string;
}): string {
  if (session.nameSource === "manual") return session.name;
  return meaningfulTitle(session.title) ?? session.name;
}

export function formatDerivedName(dirLabel: string | undefined, branch?: string): string {
  const base = dirLabel || "Shell";
  return branch ? `${base}${NAME_SEPARATOR}${branch}` : base;
}

// Sessions in the same repo and branch would otherwise collide, and two
// identically-named tabs are exactly the problem derived names are meant to
// fix. Applies to the stored name only: live titles are left alone, since a
// suffix that appears and disappears as programs repaint is worse than a
// momentary duplicate.
export function uniqueName(base: string, existing: Iterable<string>): string {
  const taken = new Set(existing);
  if (!taken.has(base)) return base;
  let suffix = 2;
  while (taken.has(`${base} ${suffix}`)) suffix++;
  return `${base} ${suffix}`;
}
