import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNow } from "./use-now";

const START = new Date("2026-10-12T09:00:00.000Z");

beforeEach(() => {
  vi.useFakeTimers({ now: START });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useNow", () => {
  it("starts at the current time", () => {
    const { result } = renderHook(() => useNow());
    expect(result.current.toISOString()).toBe("2026-10-12T09:00:00.000Z");
  });

  it("ticks once a minute by default", () => {
    const { result } = renderHook(() => useNow());

    act(() => {
      vi.advanceTimersByTime(59_999);
    });
    expect(result.current.toISOString()).toBe("2026-10-12T09:00:00.000Z");

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.toISOString()).toBe("2026-10-12T09:01:00.000Z");

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current.toISOString()).toBe("2026-10-12T09:02:00.000Z");
  });

  it("uses a custom interval", () => {
    const { result } = renderHook(() => useNow(1_000));

    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(result.current.toISOString()).toBe("2026-10-12T09:00:03.000Z");
  });

  it("stops ticking when unmounted", () => {
    const { unmount } = renderHook(() => useNow());
    expect(vi.getTimerCount()).toBe(1);

    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
