import * as React from "react"

/** The media query list, or null where there is nothing to ask — a server
 * render, or a test runner with no `matchMedia`. Not cached: a test swaps
 * `matchMedia` between cases, and the list has to come from the current one. */
function mediaQuery(query: string): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null
  return window.matchMedia(query)
}

/**
 * Whether a media query holds, kept current as it changes.
 *
 * Seeded synchronously rather than in an effect, which is the whole reason this
 * is not three lines inline in each caller. State that starts at a placeholder
 * and is filled in after the first paint means *every* client begins life with
 * the fallback's answer — and the callers here decide things at their first
 * render that cannot be taken back: an `autoFocus` that pops the soft keyboard,
 * a Radix trigger that swallows the tap that mounts it.
 *
 * `fallback` is what to assume where there is nothing to ask, so each caller
 * names the safe side of its own question rather than inheriting a default.
 */
export function useMediaQuery(query: string, fallback: boolean): boolean {
  const [matches, setMatches] = React.useState(() => mediaQuery(query)?.matches ?? fallback)

  React.useEffect(() => {
    const mql = mediaQuery(query)
    if (!mql) return
    const onChange = () => setMatches(mql.matches)
    mql.addEventListener("change", onChange)
    // The answer can have moved between the first render and this effect — a
    // rotation during hydration, a window resized while the tab was in the
    // background, a keyboard folio attached to a tablet.
    onChange()
    return () => mql.removeEventListener("change", onChange)
  }, [query])

  return matches
}
