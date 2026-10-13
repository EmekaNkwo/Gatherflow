import * as React from "react";

const MOBILE_BREAKPOINT = 768;

/**
 * Tracks whether the viewport is narrow enough to treat as mobile.
 *
 * Subscribes through `useSyncExternalStore` so the value is read during
 * render rather than written back into state from an effect, which keeps the
 * first paint correct and avoids a cascading re-render.
 */
export function useIsMobile(): boolean {
  const subscribe = React.useCallback((onChange: () => void) => {
    const query = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return React.useSyncExternalStore(
    subscribe,
    () => window.innerWidth < MOBILE_BREAKPOINT,
    // Server rendering has no viewport; desktop is the safer assumption
    // because the sidebar then renders in its normal place.
    () => false,
  );
}
