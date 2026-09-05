import * as React from "react"

/** Below this width the shell is a phone: one tab group, and both sidebars
 * float as sheets rather than holding a column (§9). In rem, because it is
 * Tailwind's `md` (`--breakpoint-md: 48rem`), and the CSS beside a decision
 * made here — `Composer`'s `p-3 md:p-6` — has to flip at the same width. */
export const MOBILE_BREAKPOINT_REM = 48

/**
 * The exact complement of Tailwind's `md:`, which is `(width >= 48rem)`.
 * Written as a negation rather than a `max-width` so the boundary is the same
 * strict one: `(max-width: 767px)` is `<= 767`, which leaves the sub-pixel
 * band a zoomed viewport can land in answering "desktop" while the CSS says
 * phone — and a px threshold drifts from a rem one the moment the root font
 * size is not 16px. `not all and (...)` is CSS 2.1 syntax, so every
 * `matchMedia` parses it; a malformed query would silently match nothing and
 * pin this to false, which is why it is not built from anything else.
 */
const QUERY = `not all and (min-width: ${MOBILE_BREAKPOINT_REM}rem)`

/** The media query list, or null where there is nothing to ask — a server
 * render, or a test runner with no `matchMedia`. Not cached: a test swaps
 * `matchMedia` between cases, and the list has to come from the current one. */
function mediaQuery(): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null
  return window.matchMedia(QUERY)
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
  const [isMobile, setIsMobile] = React.useState(() => mediaQuery()?.matches ?? false)

  React.useEffect(() => {
    const mql = mediaQuery()
    if (!mql) return
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
