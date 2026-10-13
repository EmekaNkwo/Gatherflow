"use client";

import { useEffect, useState } from "react";

/**
 * A clock that ticks once a minute.
 *
 * Due dates, overdue flags and "today" counts all depend on the current
 * time, so they come from here rather than from `new Date()` inside render
 * paths — that keeps a render deterministic and avoids every component
 * disagreeing about what "today" is.
 */
export function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);

  return now;
}
