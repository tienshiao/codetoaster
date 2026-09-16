import { test, expect } from "bun:test";
import type { ILink, ILinkProvider } from "@xterm/xterm";
import { combineLinkProviders } from "./terminal-links";

/**
 * Two kinds of link behind `XTerminal`'s one `linkProvider` prop (TASK-108).
 */

function link(text: string): ILink {
  return {
    text,
    range: { start: { x: 1, y: 1 }, end: { x: text.length, y: 1 } },
    activate: () => {},
  };
}

/** A provider that answers with `links`, now or when `release` is called. */
function part(links: ILink[] | undefined, deferred = false) {
  let pending: (() => void) | undefined;
  const provider: ILinkProvider = {
    provideLinks(_y, callback) {
      if (deferred) pending = () => callback(links);
      else callback(links);
    },
  };
  return { factory: () => provider, release: () => pending?.() };
}

function ask(provider: ILinkProvider) {
  const calls: (ILink[] | undefined)[] = [];
  provider.provideLinks(1, (links) => calls.push(links));
  return calls;
}

test("nothing given is nothing registered", () => {
  expect(combineLinkProviders(undefined, undefined)).toBeUndefined();
});

test("a single factory is passed through as itself", () => {
  // So adding a second kind of link does not change the identity `XTerminal`
  // keys its registration on while only one of them is available.
  const only = part([link("a")]).factory;
  expect(combineLinkProviders(undefined, only)).toBe(only);
  expect(combineLinkProviders(only, undefined)).toBe(only);
});

test("two factories answer once, with both sets of links in order", () => {
  const combined = combineLinkProviders(part([link("a")]).factory, part([link("b"), link("c")]).factory)!;
  const calls = ask(combined({}));
  expect(calls.length).toBe(1);
  expect(calls[0]?.map((l) => l.text)).toEqual(["a", "b", "c"]);
});

test("the answer waits for a part that answers late", () => {
  const late = part([link("b")], true);
  const combined = combineLinkProviders(part([link("a")]).factory, late.factory)!;
  const calls = ask(combined({}));
  expect(calls).toEqual([]);
  late.release();
  expect(calls.map((c) => c?.map((l) => l.text))).toEqual([["a", "b"]]);
});

test("no links from anyone is undefined, not an empty list", () => {
  const combined = combineLinkProviders(part(undefined).factory, part([]).factory)!;
  expect(ask(combined({}))).toEqual([undefined]);
});

test("a part calling back twice does not answer twice", () => {
  const noisy: ILinkProvider = {
    provideLinks(_y, callback) {
      callback([link("a")]);
      callback([link("a")]);
    },
  };
  const late = part([link("b")], true);
  const combined = combineLinkProviders(() => noisy, late.factory)!;
  const calls = ask(combined({}));
  // The second call from the noisy part must not stand in for the late one.
  expect(calls).toEqual([]);
  late.release();
  expect(calls.length).toBe(1);
});
