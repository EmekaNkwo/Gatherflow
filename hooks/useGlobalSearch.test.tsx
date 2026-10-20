import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEAM_IDS } from "@/data/seed";
import { resetHarness, seedChurch } from "@/tests/hooks-harness";
import { useGlobalSearch } from "./useGlobalSearch";

vi.mock("@/services/commands/client");
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

beforeEach(() => vi.useFakeTimers());
afterEach(resetHarness);

function type(setQuery: (value: string) => void, value: string, wait: number): void {
  act(() => setQuery(value));
  act(() => {
    vi.advanceTimersByTime(wait);
  });
}

describe("useGlobalSearch", () => {
  it("waits for the debounce before searching", () => {
    seedChurch({ role: "administrator" });
    const { result } = renderHook(() => useGlobalSearch(200));

    act(() => result.current.setQuery("Achebe"));
    expect(result.current.searching).toBe(true);
    expect(result.current.hasQuery).toBe(false);
    expect(result.current.results).toEqual([]);

    act(() => {
      vi.advanceTimersByTime(199);
    });
    expect(result.current.searching).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.searching).toBe(false);
    expect(result.current.hasQuery).toBe(true);
    expect(result.current.results.map((entry) => entry.id)).toContain("person_1");
  });

  it("groups results by kind", () => {
    seedChurch({ role: "administrator" });
    const { result } = renderHook(() => useGlobalSearch(0));

    type(result.current.setQuery, "Stephen", 0);

    expect(result.current.grouped.member?.length).toBeGreaterThanOrEqual(2);
    const total = Object.values(result.current.grouped).reduce((sum, list) => sum + list.length, 0);
    expect(total).toBe(result.current.results.length);
    for (const [kind, list] of Object.entries(result.current.grouped)) {
      expect(list.every((entry) => entry.kind === kind)).toBe(true);
    }
  });

  it("does not search on a single character", () => {
    seedChurch({ role: "administrator" });
    const { result } = renderHook(() => useGlobalSearch(0));

    type(result.current.setQuery, "S", 0);

    expect(result.current.hasQuery).toBe(false);
    expect(result.current.results).toEqual([]);
    expect(result.current.grouped).toEqual({});
  });

  it("finds nothing in the directory for a plain member", () => {
    seedChurch({ role: "member", teamMemberId: TEAM_IDS.member });
    const { result } = renderHook(() => useGlobalSearch(0));

    type(result.current.setQuery, "Achebe", 0);

    expect(result.current.hasQuery).toBe(true);
    expect(result.current.results.filter((entry) => entry.kind === "member")).toEqual([]);
  });

  it("finds only a volunteer's own tasks", () => {
    const snapshot = seedChurch({ role: "volunteer", teamMemberId: TEAM_IDS.volunteerAmara });
    const { result } = renderHook(() => useGlobalSearch(0));

    type(result.current.setQuery, "FU-", 0);

    const taskIds = result.current.results.filter((entry) => entry.kind === "task").map((entry) => entry.id);
    expect(taskIds.length).toBeGreaterThan(0);
    const owners = new Set(
      taskIds.map((id) => snapshot.tasks.find((task) => task.id === id)?.assigneeId),
    );
    expect(owners).toEqual(new Set([TEAM_IDS.volunteerAmara]));
  });
});
