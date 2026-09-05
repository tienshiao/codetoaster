import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { builtinProfiles, validateProfile, type AgentProfile } from "./profile";

/**
 * Which profiles this daemon knows, and where they come from (TASK-89.2).
 *
 * **Profiles come from the daemon's own configuration and never from an HTTP
 * body.** A profile is a binary plus argv templates — a command template by any
 * other name — and handing one to `POST /api/tasks` would be exactly the raw
 * argv over HTTP that TASK-42 closed off: the daemon spawns processes in the
 * user's repositories with no authentication in front of it, so anything that
 * could reach the API could choose what runs. The API therefore only ever
 * *names* a profile, and the name is looked up here. `CreateTaskOptions.command`
 * survives as the in-process override the tests use, and stays off the wire for
 * the same reason.
 *
 * The file is `~/.codetoaster/profiles.json`: an object keyed by profile name,
 * each value the profile shape minus its name (`label` optional, defaulting to
 * the name). A user entry named like a built-in replaces it, which is how a
 * `claude` that lives somewhere unusual, or a `pi` invoked with an extra flag,
 * is configured without patching the source.
 *
 * Read once at startup, and a bad file throws rather than degrading. Every
 * failure here is a typo in a file the user just edited: failing the daemon's
 * start names it while they still remember writing it, where falling back to
 * the built-ins would be a silent "your profile does nothing" discovered at the
 * first task — or, worse, a task quietly running claude when it was told to run
 * something else.
 */

/** The profile a task gets when nothing names one: today's behaviour. Defined
 * in `profile.ts` — which imports nothing — so the frontend can read it
 * without this file's `fs` coming with it, and re-exported here because this
 * is where every server-side caller already looks for it. */
export { DEFAULT_PROFILE } from "./profile";

/** A name nothing in the registry answers to. Its own type so the API layer can
 * tell "you asked for a profile that does not exist" (a 400) from every other
 * way a create can fail (a 500). */
export class UnknownProfileError extends Error {
  constructor(name: string) {
    super(`Unknown agent profile ${JSON.stringify(name)}`);
    this.name = "UnknownProfileError";
  }
}

export class ProfileRegistry {
  private byName = new Map<string, AgentProfile>();

  /** Later entries replace earlier ones of the same name, which is what makes
   * "the built-ins, then the user's" the whole of the merge. Insertion order is
   * kept across a replacement, so a user's `claude` sits where the built-in was
   * rather than jumping to the end of the list. */
  constructor(
    profiles: AgentProfile[],
    /** The names that came from the user's configuration rather than from the
     * built-ins, so startup can say how many were loaded. */
    readonly userDefined: readonly string[] = [],
  ) {
    for (const profile of profiles) this.byName.set(profile.name, profile);
  }

  get(name: string): AgentProfile | undefined {
    return this.byName.get(name);
  }

  /** The profile, or a throw naming what was asked for. Callers that are about
   * to spawn something want this: a create that silently fell back to the
   * default would run the wrong agent in the user's checkout. */
  require(name: string): AgentProfile {
    const profile = this.byName.get(name);
    if (!profile) throw new UnknownProfileError(name);
    return profile;
  }

  /** Built-in order, with anything the user added after them. */
  list(): AgentProfile[] {
    return [...this.byName.values()];
  }
}

export function profilesPath(): string {
  return path.join(os.homedir(), ".codetoaster", "profiles.json");
}

/** The registry the daemon runs on: the built-ins, with the user's file merged
 * over them. A missing file is the normal case and means the built-ins. */
export function loadProfiles(
  filePath: string = profilesPath(),
  env: Record<string, string | undefined> = process.env,
): ProfileRegistry {
  const builtins = builtinProfiles(env);
  let text: string;
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch (e: unknown) {
    // Only "there is no such file" is the normal case. A directory, a
    // permission error or an unreadable disk is a file the user meant to be
    // read, and swallowing it would run every task on the built-ins while the
    // configuration they wrote sat there being ignored.
    if ((e as NodeJS.ErrnoException)?.code === "ENOENT") return new ProfileRegistry(builtins);
    throw new Error(`Could not read agent profiles from ${filePath}: ${messageOf(e)}`);
  }

  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch (e: unknown) {
    throw new Error(`Could not parse agent profiles in ${filePath}: ${messageOf(e)}`);
  }
  if (document === null || typeof document !== "object" || Array.isArray(document)) {
    throw new Error(
      `Agent profiles in ${filePath} must be an object keyed by profile name`,
    );
  }

  const userDefined: string[] = [];
  const profiles = [...builtins];
  for (const [name, value] of Object.entries(document as Record<string, unknown>)) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(
        `Agent profiles in ${filePath}: profile ${JSON.stringify(name)} must be an object`,
      );
    }
    // The key is the name — a `name` inside the value would be a second place
    // to say it, and the two would disagree the first time one was renamed.
    // `label` defaults to the name, since a profile nobody labelled is still
    // one the composer has to be able to print.
    const profile = { ...(value as Omit<AgentProfile, "name">), name } as AgentProfile;
    if (typeof profile.label !== "string" || profile.label === "") profile.label = name;
    try {
      validateProfile(profile);
    } catch (e: unknown) {
      // validateProfile's message already names the profile.
      throw new Error(`Agent profiles in ${filePath}: ${messageOf(e)}`);
    }
    profiles.push(profile);
    userDefined.push(name);
  }
  return new ProfileRegistry(profiles, userDefined);
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
