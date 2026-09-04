/**
 * Poll `predicate` every 25ms until it holds or `ms` have passed, and answer
 * whether it held. The predicate is asked once more past the deadline, so the
 * caller gets its final word rather than the last poll's — and can assert on
 * the boolean, which names "never became true" as the failure instead of
 * whatever the next `expect` happens to say about a half-arrived state.
 *
 * Keep the deadline under the runner's per-test timeout (Bun's is 5000ms and
 * `bunfig.toml` does not raise it): a wait that runs past it fails as a harness
 * timeout, which skips the test's `finally` and leaves whatever it spawned.
 */
export async function waitFor(predicate: () => boolean | Promise<boolean>, ms = 4000): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return predicate();
}
