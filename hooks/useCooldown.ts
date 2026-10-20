"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * A wait the server asked for, counted down a second at a time. While it is
 * active the page disables its button and says "Try again in 12s"; when it
 * runs out, the button comes back by itself.
 */
export function useCooldown() {
  const [until, setUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (until === null) return;
    const timer = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= until) setUntil(null);
    }, 1000);
    return () => clearInterval(timer);
  }, [until]);

  const start = useCallback((seconds: number) => {
    const current = Date.now();
    setNow(current);
    setUntil(current + Math.max(1, seconds) * 1000);
  }, []);

  const remaining = until === null ? 0 : Math.max(0, Math.ceil((until - now) / 1000));
  return { remaining, active: remaining > 0, start };
}
