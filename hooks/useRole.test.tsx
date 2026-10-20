import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TEAM_IDS } from "@/data/seed";
import { resetHarness, seedChurch } from "@/tests/hooks-harness";
import { useRole } from "./useRole";

vi.mock("@/services/commands/client");
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

afterEach(resetHarness);

describe("useRole", () => {
  it("resolves a volunteer's team member and limited capabilities", () => {
    seedChurch({ role: "volunteer", teamMemberId: TEAM_IDS.volunteerAmara });
    const { result } = renderHook(() => useRole());

    expect(result.current.role).toBe("volunteer");
    expect(result.current.teamMemberId).toBe(TEAM_IDS.volunteerAmara);
    expect(result.current.currentMember?.name).toBe("Amara Nwosu");
    expect(result.current.can("tasks.read.own")).toBe(true);
    expect(result.current.can("tasks.read.all")).toBe(false);
    expect(result.current.can("care.read")).toBe(false);
    expect(result.current.canAll(["people.read", "visitors.write"])).toBe(true);
    expect(result.current.canAll(["people.read", "settings.write"])).toBe(false);
  });

  it("gives a pastor care access but not settings", () => {
    seedChurch({ role: "pastor", teamMemberId: TEAM_IDS.pastor });
    const { result } = renderHook(() => useRole());

    expect(result.current.can("care.read")).toBe(true);
    expect(result.current.can("settings.write")).toBe(false);
    expect(result.current.capabilities).toContain("care.write");
  });

  it("gives a member nothing and no team record when unlinked", () => {
    seedChurch({ role: "member", teamMemberId: null });
    const { result } = renderHook(() => useRole());

    expect(result.current.capabilities).toEqual([]);
    expect(result.current.currentMember).toBeUndefined();
    expect(result.current.canAll([])).toBe(true);
    expect(result.current.can("people.read")).toBe(false);
  });

  it("offers only active, non-member team members for assignment", () => {
    const snapshot = seedChurch({ role: "administrator", teamMemberId: TEAM_IDS.admin });
    const { result } = renderHook(() => useRole());

    expect(result.current.team).toBe(snapshot.team);
    expect(result.current.assignableTeam.map((member) => member.id)).toEqual([
      TEAM_IDS.admin,
      TEAM_IDS.pastor,
      TEAM_IDS.coordinator,
      TEAM_IDS.volunteerAmara,
      TEAM_IDS.volunteerTunde,
      TEAM_IDS.careLead,
    ]);
  });
});
