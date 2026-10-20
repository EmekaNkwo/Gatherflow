import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetHarness, seedChurch } from "@/tests/hooks-harness";
import { useMemberJourney } from "./useMemberJourney";

vi.mock("@/services/commands/client");
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

afterEach(resetHarness);

// person_5 has a pastoral-care record, so their timeline holds a restricted entry.
const PERSON = "person_5";

describe("useMemberJourney", () => {
  it("includes restricted timeline entries for a pastor", () => {
    const snapshot = seedChurch({ role: "pastor" });
    const { result } = renderHook(() => useMemberJourney(PERSON));

    const all = snapshot.activity.filter((event) => event.personId === PERSON);
    expect(result.current.restrictedHidden).toBe(false);
    expect(result.current.timeline).toHaveLength(all.length);
    expect(result.current.timeline.some((event) => event.visibility === "restricted")).toBe(true);
  });

  it("hides restricted entries from an administrator", () => {
    const snapshot = seedChurch({ role: "administrator" });
    const { result } = renderHook(() => useMemberJourney(PERSON));

    const general = snapshot.activity.filter(
      (event) => event.personId === PERSON && event.visibility === "general",
    );
    expect(result.current.restrictedHidden).toBe(true);
    expect(result.current.timeline).toHaveLength(general.length);
    expect(result.current.timeline.every((event) => event.visibility === "general")).toBe(true);
  });

  it("splits milestones into reached, the next required one, and the latest", () => {
    seedChurch({ role: "administrator" });
    const { result } = renderHook(() => useMemberJourney(PERSON));
    const { milestones, reached, next, latest } = result.current;

    expect(milestones.length).toBeGreaterThan(0);
    expect(reached).toEqual(milestones.filter((milestone) => milestone.at));
    expect(next).toBe(milestones.find((milestone) => !milestone.at && !milestone.optional));
    const latestAt = reached.map((milestone) => milestone.at ?? "").sort().at(-1);
    expect(latest?.at).toBe(latestAt);
  });

  it("is empty for someone not in the directory", () => {
    seedChurch({ role: "pastor" });
    const { result } = renderHook(() => useMemberJourney("person_missing"));

    expect(result.current.milestones).toEqual([]);
    expect(result.current.reached).toEqual([]);
    expect(result.current.next).toBeUndefined();
    expect(result.current.latest).toBeUndefined();
    expect(result.current.timeline).toEqual([]);
  });
});
