import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useCooldown } from "./useCooldown";

describe("useCooldown", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("is idle until started", () => {
    const { result } = renderHook(() => useCooldown());
    expect(result.current).toMatchObject({ active: false, remaining: 0 });
  });

  it("counts down each second, then lets the person try again", () => {
    const { result } = renderHook(() => useCooldown());
    act(() => result.current.start(3));
    expect(result.current).toMatchObject({ active: true, remaining: 3 });

    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.remaining).toBe(2);

    act(() => vi.advanceTimersByTime(2000));
    expect(result.current).toMatchObject({ active: false, remaining: 0 });
  });

  it("restarts from the newer wait when started again", () => {
    const { result } = renderHook(() => useCooldown());
    act(() => result.current.start(2));
    act(() => result.current.start(10));
    act(() => vi.advanceTimersByTime(3000));
    expect(result.current.remaining).toBe(7);
  });
});
