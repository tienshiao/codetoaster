import { test, expect, describe, afterEach } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { builtinProfiles, type AgentProfile } from "./profile";
import {
  DEFAULT_PROFILE,
  ProfileRegistry,
  UnknownProfileError,
  loadProfiles,
  profilesPath,
} from "./profiles";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** A profiles.json in a directory of its own, so nothing here can read or
 * write the file belonging to whoever is running the suite. */
function profilesFile(document: unknown): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codetoaster-profiles-"));
  tempDirs.push(dir);
  const file = path.join(dir, "profiles.json");
  fs.writeFileSync(file, typeof document === "string" ? document : JSON.stringify(document));
  return file;
}

/** A path in a directory that exists, pointing at a file that does not. */
function missingFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codetoaster-profiles-"));
  tempDirs.push(dir);
  return path.join(dir, "profiles.json");
}

const ENV = { SHELL: "/bin/zsh" };

const REC: AgentProfile = {
  name: "rec",
  label: "Recorder",
  bin: "/tmp/rec",
  start: ["--session-id", "{session_id}", "--", "{prompt}"],
};

describe("ProfileRegistry", () => {
  test("answers by name and lists in insertion order", () => {
    const registry = new ProfileRegistry(builtinProfiles(ENV));
    expect(registry.get("claude")?.bin).toBe("claude");
    expect(registry.get("shell")?.bin).toBe("/bin/zsh");
    expect(registry.list().map((p) => p.name)).toEqual(["claude", "shell", "pi"]);
  });

  test("get answers undefined for a name nothing holds; require throws", () => {
    const registry = new ProfileRegistry(builtinProfiles(ENV));
    expect(registry.get("nope")).toBeUndefined();
    expect(() => registry.require("nope")).toThrow(UnknownProfileError);
    // The name is in the message: it is the one thing the user typed.
    expect(() => registry.require("nope")).toThrow(/"nope"/);
  });

  test("a later entry replaces an earlier one of the same name, in place", () => {
    const mine: AgentProfile = { ...REC, name: "claude", bin: "/opt/claude" };
    const registry = new ProfileRegistry([...builtinProfiles(ENV), mine]);
    expect(registry.require("claude").bin).toBe("/opt/claude");
    // Replaced, not appended: the built-in order is what the composer shows.
    expect(registry.list().map((p) => p.name)).toEqual(["claude", "shell", "pi"]);
  });

  test("the default profile is claude", () => {
    expect(DEFAULT_PROFILE).toBe("claude");
    expect(new ProfileRegistry(builtinProfiles(ENV)).require(DEFAULT_PROFILE).name).toBe("claude");
  });
});

describe("loadProfiles", () => {
  test("no file at all is the built-ins", () => {
    const registry = loadProfiles(missingFile(), ENV);
    expect(registry.list().map((p) => p.name)).toEqual(["claude", "shell", "pi"]);
    expect(registry.userDefined).toEqual([]);
  });

  test("the default path is under ~/.codetoaster", () => {
    expect(profilesPath()).toBe(path.join(os.homedir(), ".codetoaster", "profiles.json"));
  });

  test("a user profile is added after the built-ins", () => {
    const file = profilesFile({
      rec: { label: "Recorder", bin: "/tmp/rec", start: ["--", "{prompt}"] },
    });
    const registry = loadProfiles(file, ENV);
    expect(registry.list().map((p) => p.name)).toEqual(["claude", "shell", "pi", "rec"]);
    expect(registry.require("rec").label).toBe("Recorder");
    expect(registry.userDefined).toEqual(["rec"]);
  });

  test("a profile with no label is labelled with its name", () => {
    const registry = loadProfiles(profilesFile({ rec: { bin: "/tmp/rec", start: [] } }), ENV);
    expect(registry.require("rec").label).toBe("rec");
  });

  test("a user entry named like a built-in replaces it", () => {
    const file = profilesFile({
      claude: { bin: "/opt/homebrew/bin/claude", start: ["--session-id", "{session_id}"] },
    });
    const registry = loadProfiles(file, ENV);
    expect(registry.require("claude").bin).toBe("/opt/homebrew/bin/claude");
    expect(registry.require("claude").start).toEqual(["--session-id", "{session_id}"]);
    expect(registry.list()).toHaveLength(3);
  });

  test("bad JSON names the file", () => {
    const file = profilesFile("{ not json");
    expect(() => loadProfiles(file, ENV)).toThrow(new RegExp(escape(file)));
  });

  test("a document that is not an object names the file", () => {
    // Raw text, so the "a string" case is a JSON string rather than this
    // helper's own escape hatch for writing malformed JSON.
    for (const document of ['[{"name": "rec"}]', '"a string"', "7"]) {
      const file = profilesFile(document);
      expect(() => loadProfiles(file, ENV)).toThrow(new RegExp(escape(file)));
      expect(() => loadProfiles(file, ENV)).toThrow(/object keyed by profile name/);
    }
  });

  test("an entry that is not an object names the profile", () => {
    const file = profilesFile({ rec: "claude --go" });
    expect(() => loadProfiles(file, ENV)).toThrow(/"rec"/);
  });

  test("an invalid profile names the profile and the problem", () => {
    // No bin: validateProfile's own message, carried up with the file's path.
    const file = profilesFile({ rec: { start: [] } });
    expect(() => loadProfiles(file, ENV)).toThrow(/"rec"/);
    expect(() => loadProfiles(file, ENV)).toThrow(/needs a bin/);
    expect(() => loadProfiles(file, ENV)).toThrow(new RegExp(escape(file)));
  });

  test("a template naming an unknown placeholder is refused", () => {
    const file = profilesFile({ rec: { bin: "/tmp/rec", start: ["--who", "{whom}"] } });
    expect(() => loadProfiles(file, ENV)).toThrow(/unknown placeholder \{whom\}/);
  });

  test("a resume template replaying the prompt is refused", () => {
    const file = profilesFile({
      rec: { bin: "/tmp/rec", start: ["--", "{prompt}"], resume: ["--again", "{prompt}"] },
    });
    expect(() => loadProfiles(file, ENV)).toThrow(/must not name \{prompt\}/);
  });

  test("a directory where the file should be is an error, not a missing file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codetoaster-profiles-"));
    tempDirs.push(dir);
    const asDir = path.join(dir, "profiles.json");
    fs.mkdirSync(asDir);
    expect(() => loadProfiles(asDir, ENV)).toThrow(new RegExp(escape(asDir)));
  });
});

function escape(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
