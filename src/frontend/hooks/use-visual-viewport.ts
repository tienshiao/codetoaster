import { useEffect } from "react";

/**
 * Keeps `--app-height` on <html> in sync with the visual viewport so the app
 * shrinks above the on-screen keyboard. iOS Safari (and Android Chrome
 * without interactive-widget=resizes-content) overlays the keyboard on the
 * layout viewport instead of resizing it, so a plain 100svh layout gets
 * covered while the hidden xterm textarea is being typed into.
 */
export function useVisualViewportHeight() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const update = () => {
      // Ignore pinch-zoom, where the visual viewport shrinks without the
      // keyboard being involved.
      if (vv.scale !== 1) return;
      document.documentElement.style.setProperty("--app-height", `${vv.height}px`);
      // iOS scrolls the layout viewport to reveal the focused textarea;
      // with the app shrunk to fit, keep it pinned to the top instead.
      window.scrollTo(0, 0);
    };

    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      document.documentElement.style.removeProperty("--app-height");
    };
  }, []);
}
