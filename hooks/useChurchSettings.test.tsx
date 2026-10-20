import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChurchStore } from "@/stores/church-store";
import {
  acceptCommands,
  invoke,
  lastCommand,
  refuseCommands,
  resetHarness,
  seedChurch,
  seedSnapshot,
  toastMock,
} from "@/tests/hooks-harness";
import { useChurchSettings } from "./useChurchSettings";

vi.mock("@/services/commands/client");
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

afterEach(resetHarness);

describe("useChurchSettings data", () => {
  it("exposes the settings, rules, services, team and load report", () => {
    const snapshot = seedChurch();
    const report = { dropped: 2, issues: ["Two tasks were malformed."] };
    useChurchStore.setState({ report });
    const { result } = renderHook(() => useChurchSettings());

    expect(result.current.settings.churchName).toBe("Grace Community Church");
    expect(result.current.rules).toHaveLength(5);
    expect(result.current.services).toHaveLength(4);
    expect(result.current.team).toBe(snapshot.team);
    expect(result.current.report).toBe(report);
  });

  it("sorts pipeline stages by their order, whatever order they are stored in", () => {
    const snapshot = seedSnapshot();
    snapshot.settings = {
      ...snapshot.settings,
      pipelineStages: [...snapshot.settings.pipelineStages].reverse(),
    };
    seedChurch({ snapshot });
    const { result } = renderHook(() => useChurchSettings());

    expect(result.current.stages.map((stage) => stage.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(result.current.stages[0].id).toBe("new_visitor");
  });
});

describe("useChurchSettings actions", () => {
  beforeEach(() => {
    seedChurch({ role: "administrator" });
    acceptCommands({ notices: ["Settings saved."] });
  });

  type Hook = ReturnType<typeof useChurchSettings>;
  const stages = seedSnapshot().settings.pipelineStages.slice(0, 2);
  const services = seedSnapshot().settings.services.slice(0, 1);
  const cases: Array<[string, (hook: Hook) => Promise<unknown>, string, unknown]> = [
    [
      "saveProfile",
      (hook) => hook.saveProfile({ churchName: "Grace Church", defaultFollowUpDueInDays: 3 }),
      "settings.updateProfile",
      { churchName: "Grace Church", defaultFollowUpDueInDays: 3 },
    ],
    [
      "saveRule",
      (hook) => hook.saveRule("overdue_alert", { enabled: false, dueInDays: 2 }),
      "settings.updateAutomationRule",
      { id: "overdue_alert", changes: { enabled: false, dueInDays: 2 } },
    ],
    [
      "saveEngagement",
      (hook) => hook.saveEngagement({ maxContactAttempts: 4 }),
      "settings.updateEngagement",
      { maxContactAttempts: 4 },
    ],
    ["saveStages", (hook) => hook.saveStages(stages), "settings.updatePipelineStages", { stages }],
    ["saveServices", (hook) => hook.saveServices(services), "settings.updateServices", { services }],
    [
      "saveTeamMember",
      (hook) => hook.saveTeamMember({ name: "Kemi Ade", role: "volunteer", title: "Welcome desk" }),
      "settings.upsertTeamMember",
      { name: "Kemi Ade", role: "volunteer", title: "Welcome desk" },
    ],
    [
      "setMemberActive",
      (hook) => hook.setMemberActive("tm_vol_esther", true),
      "settings.setTeamMemberActive",
      { teamMemberId: "tm_vol_esther", active: true },
    ],
  ];

  it.each(cases)("%s dispatches the matching command", async (_label, action, name, input) => {
    const { result } = renderHook(() => useChurchSettings());
    const outcome = await invoke(() => action(result.current));

    expect(lastCommand()).toEqual({ name, input });
    expect(outcome).toMatchObject({ ok: true });
  });

  it("sends a copy of the stage list rather than the caller's array", async () => {
    const { result } = renderHook(() => useChurchSettings());
    await invoke(() => result.current.saveStages(stages));

    const sent = lastCommand().input as { stages: unknown[] };
    expect(sent.stages).toEqual(stages);
    expect(sent.stages).not.toBe(stages);
  });

  it("shows the new church name once the server accepts it", async () => {
    acceptCommands({
      notices: ["Settings saved."],
      change: (snapshot) => ({ ...snapshot, settings: { ...snapshot.settings, churchName: "Grace Church" } }),
    });
    const { result } = renderHook(() => useChurchSettings());

    await invoke(() => result.current.saveProfile({ churchName: "Grace Church" }));

    expect(result.current.settings.churchName).toBe("Grace Church");
    expect(toastMock.success).toHaveBeenCalledWith("Settings saved.", { description: undefined });
  });

  it("returns a refusal and shows it", async () => {
    refuseCommands("Only an administrator can change settings.", "forbidden");
    const { result } = renderHook(() => useChurchSettings());

    const outcome = await invoke(() => result.current.saveEngagement({ maxContactAttempts: 0 }));

    expect(outcome).toMatchObject({ ok: false, code: "forbidden" });
    expect(toastMock.error).toHaveBeenCalledWith("Only an administrator can change settings.");
  });
});
