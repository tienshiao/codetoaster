import * as React from "react"

/** Below this width the shell is a phone: one tab group, and both sidebars
 * float as sheets rather than holding a column (§9). */
export const MOBILE_BREAKPOINT = 768

const QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

/** The answer the media query gives right now, or false where there is nothing
 * to ask — a server render, or a test runner with no `matchMedia`. */
function matchesNow(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false
  return window.matchMedia(QUERY).matches
}

/**
 * Whether the viewport is a phone's.
 *
 * Seeded synchronously rather than in an effect. The state used to start
 * undefined and be filled in after the first paint, so *every* client began
 * life saying "not mobile" — a phone painted the three-column desktop layout
 * for a frame before collapsing it. That was cosmetic while nothing but layout
 * read it; it is not any more. `Composer`'s `autoFocus` is decided at its first
 * render, and a first render that says desktop pops the soft keyboard before
 * the user has asked to type; `TaskShell`'s single-group rule is read the same
 * way, and would let the frame through in which a split is still offered.
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = React.useState(matchesNow)

  React.useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return
    const mql = window.matchMedia(QUERY)
    const onChange = () => setIsMobile(mql.matches)
    mql.addEventListener("change", onChange)
    // The viewport can have moved between the first render and this effect —
    // a rotation during hydration, or a window resized while the tab was in
    // the background.
    onChange()
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return isMobile
}
