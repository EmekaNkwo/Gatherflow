import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useIsMobile } from "./use-mobile";

interface FakeQuery {
  media: string;
  listeners: Set<() => void>;
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
}

let queries: FakeQuery[] = [];
const originalWidth = window.innerWidth;

function setWidth(width: number): void {
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: width });
}

function fireChange(): void {
  for (const query of queries) for (const listener of query.listeners) listener();
}

beforeEach(() => {
  queries = [];
  vi.stubGlobal(
    "matchMedia",
    vi.fn((media: string) => {
      const query: FakeQuery = {
        media,
        listeners: new Set(),
        addEventListener: (_type, listener) => query.listeners.add(listener),
        removeEventListener: (_type, listener) => query.listeners.delete(listener),
      };
      queries.push(query);
      return query;
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  setWidth(originalWidth);
});

describe("useIsMobile", () => {
  it("is true below 768px and false at or above it", () => {
    setWidth(767);
    expect(renderHook(() => useIsMobile()).result.current).toBe(true);

    setWidth(768);
    expect(renderHook(() => useIsMobile()).result.current).toBe(false);
  });

  it("watches the mobile breakpoint media query", () => {
    setWidth(1024);
    renderHook(() => useIsMobile());

    expect(queries[0].media).toBe("(max-width: 767px)");
    expect(queries[0].listeners.size).toBe(1);
  });

  it("updates when the viewport crosses the breakpoint", () => {
    setWidth(1024);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);

    act(() => {
      setWidth(500);
      fireChange();
    });
    expect(result.current).toBe(true);

    act(() => {
      setWidth(900);
      fireChange();
    });
    expect(result.current).toBe(false);
  });

  it("stops listening when unmounted", () => {
    setWidth(1024);
    const { unmount } = renderHook(() => useIsMobile());
    unmount();

    expect(queries.every((query) => query.listeners.size === 0)).toBe(true);
  });
});
