import { useMediaQuery } from "./use-media-query";

/**
 * The hover-card conventions, in one place because there is now more than one
 * card (TASK-97, TASK-102). The delays and the pointer test are what make a
 * card a *second look* rather than an interface that pops open under a moving
 * pointer, and two cards disagreeing about them would be felt immediately —
 * running down a list, one row's card would open before another's.
 */

/**
 * Long enough that dragging the pointer down the list, or flinging it across
 * the sidebar on the way somewhere else, opens nothing (AC #4). Short enough
 * that stopping on a row you meant to read does not feel like waiting.
 */
export const HOVER_OPEN_DELAY = 400;

/** Brief, and not zero: it is the grace period for a pointer that clips the
 * gap between the row and the card, and for one that drifts a pixel off a row
 * it is still reading. */
export const HOVER_CLOSE_DELAY = 100;

/**
 * Whether this device has a pointer that can hover at all.
 *
 * `(hover: hover)` alone is not that question. It describes the *primary*
 * pointer, so a touchscreen laptop or an iPad with a trackpad matches it while
 * still delivering taps — which is the case that matters, because of Radix:
 * `HoverCard.Trigger` calls `preventDefault()` on `touchstart`, sensible for
 * the anchor it is normally wrapped around and ruinous around a task row,
 * because a prevented `touchstart` suppresses the emulated click and the tap
 * stops selecting the task. There is no way to opt out of that handler, so the
 * fix is not to mount the trigger at all.
 *
 * Hence the second half: any coarse pointer on the device disqualifies it, even
 * when a fine one is also attached. That deliberately loses the card on hybrids
 * where it would have worked with a mouse, and the standing rule is what allows
 * it — everything on the card is reachable elsewhere, and a tap that does
 * nothing is not.
 *
 * Nothing is lost on a phone either way: Radix already refuses to *open* on
 * touch (`excludeTouch`), so there the trigger was never anything but that one
 * side effect.
 */
export function useHoverPointer(): boolean {
  const fine = useMediaQuery("(hover: hover) and (pointer: fine)", true);
  const anyCoarse = useMediaQuery("(any-pointer: coarse)", false);
  return fine && !anyCoarse;
}
