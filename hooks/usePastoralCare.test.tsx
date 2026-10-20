import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEAM_IDS } from "@/data/seed";
import type { DemoRole } from "@/types/team";
import {
  acceptCommands,
  invoke,
  lastCommand,
  refuseCommands,
  resetHarness,
  seedChurch,
  toastMock,
} from "@/tests/hooks-harness";
import { usePastoralCare, usePersonCareRecords } from "./usePastoralCare";

vi.mock("@/services/commands/client");
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

afterEach(resetHarness);

describe("usePastoralCare visibility", () => {
  it.each<DemoRole>(["administrator", "follow_up_coordinator", "volunteer", "member"])(
    "returns nothing at all to a %s, who lacks care.read",
    (role) => {
      seedChurch({ role });
      const { result } = renderHook(() => usePastoralCare());

      expect(result.current.authorised).toBe(false);
      expect(result.current.records).toEqual([]);
      expect(result.current.open).toEqual([]);
      expect(result.current.appointments).toEqual([]);
    },
  );

  it("gives a pastor every record, newest first, joined to person and assignee", () => {
    seedChurch({ role: "pastor", teamMemberId: TEAM_IDS.careLead });
    const { result } = renderHook(() => usePastoralCare());

    expect(result.current.authorised).toBe(true);
    expect(result.current.records.map((entry) => entry.record.id)).toEqual([
      "care_3",
      "care_1",
      "care_2",
      "care_4",
      "care_5",
    ]);
    const first = result.current.records[1];
    expect(first.person?.id).toBe("person_5");
    expect(first.assignee?.id).toBe(TEAM_IDS.careLead);
    expect(result.current.records[0].assignee).toBeUndefined();
  });

  it("counts only unresolved records as open", () => {
    seedChurch({ role: "pastor" });
    const { result } = renderHook(() => usePastoralCare());

    expect(result.current.open.map((record) => record.id)).toEqual(["care_3", "care_1", "care_2", "care_4"]);
  });

  it("lists scheduled appointments in date order", () => {
    const snapshot = seedChurch({ role: "pastor" });
    const appointment = { ...snapshot.careRecords[0].appointments[0] };
    seedChurch({
      role: "pastor",
      snapshot: {
        ...snapshot,
        careRecords: snapshot.careRecords.map((record) =>
          record.id === "care_2"
            ? {
                ...record,
                appointments: [
                  { ...appointment, id: "appointment_early", date: "2026-10-12" },
                  { ...appointment, id: "appointment_done", date: "2026-10-01", status: "completed" },
                ],
              }
            : record,
        ),
      },
    });
    const { result } = renderHook(() => usePastoralCare());

    expect(result.current.appointments.map((entry) => entry.appointment.id)).toEqual([
      "appointment_early",
      "appointment_1",
    ]);
    expect(result.current.appointments[0].record.id).toBe("care_2");
  });
});

describe("usePastoralCare actions", () => {
  beforeEach(() => {
    seedChurch({ role: "pastor", teamMemberId: TEAM_IDS.careLead });
    acceptCommands({ notices: ["Care record updated."] });
  });

  type Hook = ReturnType<typeof usePastoralCare>;
  const created = {
    personId: "person_3",
    category: "prayer_request",
    summary: "Asked for prayer",
    receivedAt: "2026-10-12",
  } as never;
  const cases: Array<[string, (hook: Hook) => Promise<unknown>, string, unknown]> = [
    ["create", (hook) => hook.create(created), "care.create", created],
    [
      "update",
      (hook) => hook.update("care_1", { nextAction: "Call back", nextActionDate: "2026-10-14" }),
      "care.update",
      { recordId: "care_1", changes: { nextAction: "Call back", nextActionDate: "2026-10-14" } },
    ],
    [
      "setStatus",
      (hook) => hook.setStatus("care_1", "resolved"),
      "care.update",
      { recordId: "care_1", changes: { status: "resolved" } },
    ],
    [
      "addNote",
      (hook) => hook.addNote("care_1", "Visited at home"),
      "care.addNote",
      { recordId: "care_1", text: "Visited at home" },
    ],
    [
      "scheduleAppointment",
      (hook) => hook.scheduleAppointment("care_1", { date: "2026-10-20", time: "14:00", location: "Office" }),
      "care.scheduleAppointment",
      { recordId: "care_1", input: { date: "2026-10-20", time: "14:00", location: "Office" } },
    ],
    [
      "updateAppointment",
      (hook) => hook.updateAppointment("care_1", "appointment_1", "completed"),
      "care.setAppointmentStatus",
      { recordId: "care_1", appointmentId: "appointment_1", status: "completed" },
    ],
  ];

  it.each(cases)("%s dispatches the matching command", async (_label, action, name, input) => {
    const { result } = renderHook(() => usePastoralCare());
    const outcome = await invoke(() => action(result.current));

    expect(lastCommand()).toEqual({ name, input });
    expect(outcome).toMatchObject({ ok: true });
    expect(toastMock.success).toHaveBeenCalledWith("Care record updated.", { description: undefined });
  });

  it("returns the server's refusal and shows it", async () => {
    refuseCommands("You are not allowed to read care records.", "forbidden");
    const { result } = renderHook(() => usePastoralCare());

    const outcome = await invoke(() => result.current.addNote("care_1", "x"));

    expect(outcome).toMatchObject({ ok: false, code: "forbidden" });
    expect(toastMock.error).toHaveBeenCalledWith("You are not allowed to read care records.");
  });
});

describe("usePersonCareRecords", () => {
  it("returns one person's records to a pastor", () => {
    seedChurch({ role: "pastor" });
    const { result } = renderHook(() => usePersonCareRecords("person_5"));
    expect(result.current.map((entry) => entry.record.id)).toEqual(["care_1"]);
  });

  it("returns nothing to a role without care access", () => {
    seedChurch({ role: "administrator" });
    const { result } = renderHook(() => usePersonCareRecords("person_5"));
    expect(result.current).toEqual([]);
  });
});
