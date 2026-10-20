import { beforeEach, describe, expect, it, vi } from "vitest";
import { ok } from "@/lib/result";
import { capabilitiesFor } from "@/lib/permissions";
import { fetchChurch } from "@/services/commands/client";
import type { ChurchSnapshot } from "@/types/snapshot";
import { useChurchStore } from "./church-store";
import { useSessionStore } from "./session-store";

vi.mock("@/services/commands/client", () => ({
  fetchChurch: vi.fn(),
  postCommand: vi.fn(),
  postEmail: vi.fn(),
}));

const initialSession = useSessionStore.getState();
const initialChurch = useChurchStore.getState();

beforeEach(() => {
  vi.clearAllMocks();
  useSessionStore.setState(initialSession, true);
  useChurchStore.setState(initialChurch, true);
});

describe("session store", () => {
  it("starts as an unresolved member who can do nothing", () => {
    const session = useSessionStore.getState();
    expect(session).toMatchObject({ role: "member", teamMemberId: null, resolved: false });
    expect(session.can("people.read")).toBe(false);
    expect(session.capabilities()).toEqual([]);
    expect(session.taskScope()).toBe("none");
  });

  it("adopts the server's role and team member", () => {
    useSessionStore.getState().adoptServerSession("volunteer", "tm_7");

    const session = useSessionStore.getState();
    expect(session).toMatchObject({ role: "volunteer", teamMemberId: "tm_7", resolved: true });
    expect(session.can("tasks.write")).toBe(true);
    expect(session.can("tasks.assign")).toBe(false);
    expect(session.capabilities()).toBe(capabilitiesFor("volunteer"));
    expect(session.taskScope()).toBe("own");
  });

  it.each([
    ["administrator", "settings.write", true, "all"],
    ["pastor", "care.read", true, "all"],
    ["follow_up_coordinator", "care.read", false, "all"],
  ] as const)("as %s, can(%s) is %s and task scope is %s", (role, capability, allowed, scope) => {
    useSessionStore.getState().adoptServerSession(role, null);
    expect(useSessionStore.getState().can(capability)).toBe(allowed);
    expect(useSessionStore.getState().taskScope()).toBe(scope);
  });

  it("is registered as the church store's adopter, so a church load sets the role", async () => {
    vi.mocked(fetchChurch).mockResolvedValue(
      ok({
        snapshot: {} as ChurchSnapshot,
        version: 1,
        seeded: false,
        report: { dropped: 0, issues: [] },
        email: initialChurch.email,
        actingAs: { role: "pastor", teamMemberId: "tm_2" },
      }),
    );

    await useChurchStore.getState().hydrate();

    expect(useSessionStore.getState()).toMatchObject({ role: "pastor", teamMemberId: "tm_2", resolved: true });
  });
});
