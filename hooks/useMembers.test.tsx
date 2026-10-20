import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadCsv } from "@/lib/csv";
import {
  acceptCommands,
  freezeTime,
  invoke,
  lastCommand,
  refuseCommands,
  resetHarness,
  seedChurch,
  seedSnapshot,
  toastMock,
} from "@/tests/hooks-harness";
import { useMember, useMembers, usePerson } from "./useMembers";

vi.mock("@/services/commands/client");
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));
vi.mock("@/lib/csv", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/csv")>()),
  downloadCsv: vi.fn(),
}));

beforeEach(() => freezeTime());
afterEach(resetHarness);

describe("useMembers data", () => {
  it("lists current members (not transferred or archived) sorted by surname", () => {
    const snapshot = seedChurch();
    const { result } = renderHook(() => useMembers());

    // M6: the same definition as the header count.
    const expected = snapshot.people.filter(
      (person) => person.member && !["archived", "transferred"].includes(person.member.status),
    );
    expect(result.current.rows).toHaveLength(expected.length);
    const names = result.current.rows.map((row) => `${row.person.lastName} ${row.person.firstName}`);
    expect(names).toEqual([...names].sort((left, right) => left.localeCompare(right)));
  });

  it("filters rows by status and search", () => {
    seedChurch();
    const { result } = renderHook(() => useMembers({ search: "Achebe" }));

    expect(result.current.rows.map((row) => row.person.id)).toContain("person_1");
    expect(result.current.rows.every((row) => row.person.lastName === "Achebe")).toBe(true);

    const { result: newOnly } = renderHook(() => useMembers({ filter: "new" }));
    expect(newOnly.current.rows.length).toBeGreaterThan(0);
    expect(newOnly.current.rows.every((row) => row.status === "new_member")).toBe(true);
  });

  it("groups people into their households", () => {
    const snapshot = seedChurch();
    const { result } = renderHook(() => useMembers());

    expect(result.current.households).toHaveLength(snapshot.households.length);
    const first = result.current.households.find((entry) => entry.household.id === "household_1");
    expect(first?.members.map((person) => person.id)).toEqual(
      expect.arrayContaining(["person_1", "person_2"]),
    );
    expect(first?.members.every((person) => person.householdId === "household_1")).toBe(true);
  });

  it("reports the membership breakdown and group participation", () => {
    const snapshot = seedChurch();
    const { result } = renderHook(() => useMembers());

    expect(result.current.breakdown.map((entry) => entry.status)).toEqual([
      "active",
      "new_member",
      "inactive",
      "transferred",
      "archived",
    ]);
    const breakdownTotal = result.current.breakdown.reduce((sum, entry) => sum + entry.count, 0);
    expect(breakdownTotal).toBe(snapshot.people.filter((person) => person.member).length);
    expect(result.current.participation.denominator).toBe(
      snapshot.people.filter(
        (person) => person.member && !["archived", "transferred"].includes(person.member.status),
      ).length,
    );
    expect(result.current.participation.numerator).toBeGreaterThan(0);
  });

  it("exports rows to a CSV named for today", () => {
    seedChurch();
    const { result } = renderHook(() => useMembers());

    result.current.exportCsv();
    result.current.exportCsv(result.current.rows.slice(0, 1), "2026-01-01");

    const calls = vi.mocked(downloadCsv).mock.calls;
    expect(calls[0][0]).toBe("gatherflow-members-2026-10-12.csv");
    expect(calls[0][1].trim().split("\n")).toHaveLength(result.current.rows.length + 1);
    expect(calls[1][0]).toBe("gatherflow-members-2026-01-01.csv");
    expect(calls[1][1].trim().split("\n")).toHaveLength(2);
  });
});

describe("useMembers actions", () => {
  beforeEach(() => {
    seedChurch();
    acceptCommands({ notices: ["Saved."], data: { personId: "person_new" } });
  });

  type Hook = ReturnType<typeof useMembers>;
  const contact = { name: "Ife", relationship: "Sister", phone: "+44 7700 900999" };
  const cases: Array<[string, (hook: Hook) => Promise<unknown>, string, unknown]> = [
    [
      "register",
      (hook) => hook.register({ firstName: "Ada", lastName: "Obi", membershipDate: "2026-10-12" }),
      "member.register",
      { firstName: "Ada", lastName: "Obi", membershipDate: "2026-10-12" },
    ],
    [
      "changeStatus",
      (hook) => hook.changeStatus("person_1", "inactive", "Moved away"),
      "member.changeStatus",
      { personId: "person_1", status: "inactive", reason: "Moved away" },
    ],
    [
      "completeOrientation",
      (hook) => hook.completeOrientation("person_1"),
      "member.recordOrientationCompleted",
      { personId: "person_1" },
    ],
    [
      "correct",
      (hook) => hook.correct("person_1", { phone: "+44 7700 900000" }),
      "person.correct",
      { personId: "person_1", changes: { phone: "+44 7700 900000" } },
    ],
    [
      "remove",
      (hook) => hook.remove("person_1", "Duplicate record"),
      "person.delete",
      { personId: "person_1", reason: "Duplicate record" },
    ],
    [
      "saveEmergencyContact",
      (hook) => hook.saveEmergencyContact("person_1", contact),
      "member.setEmergencyContact",
      { personId: "person_1", contact },
    ],
    [
      "markRequestedContact",
      (hook) => hook.markRequestedContact("person_1", true),
      "member.setRequestedContact",
      { personId: "person_1", requested: true },
    ],
    [
      "addHousehold",
      (hook) => hook.addHousehold({ name: "Obi household", area: "Riverside" }),
      "household.create",
      { name: "Obi household", area: "Riverside" },
    ],
    [
      "assignHousehold",
      (hook) => hook.assignHousehold("person_3", "household_2"),
      "person.setHousehold",
      { personId: "person_3", householdId: "household_2" },
    ],
  ];

  it.each(cases)("%s dispatches the matching command", async (_label, action, name, input) => {
    const { result } = renderHook(() => useMembers());
    const outcome = await invoke(() => action(result.current));

    expect(lastCommand()).toEqual({ name, input });
    expect(outcome).toMatchObject({ ok: true, value: { personId: "person_new", notices: ["Saved."] } });
  });

  it("re-reads the rows from the snapshot the server returns", async () => {
    const changed = seedSnapshot();
    const target = changed.people.find((person) => person.id === "person_1")!;
    target.member = { ...target.member!, status: "archived" };
    acceptCommands({ change: () => changed });
    const { result } = renderHook(() => useMembers());
    expect(result.current.rows.some((row) => row.person.id === "person_1")).toBe(true);

    await invoke(() => result.current.changeStatus("person_1", "archived"));

    expect(result.current.rows.some((row) => row.person.id === "person_1")).toBe(false);
  });

  it("returns a refusal and shows it", async () => {
    refuseCommands("Only an administrator can delete a record.", "forbidden");
    const { result } = renderHook(() => useMembers());

    const outcome = await invoke(() => result.current.remove("person_1"));

    expect(outcome).toEqual({
      ok: false,
      error: "Only an administrator can delete a record.",
      code: "forbidden",
    });
    expect(toastMock.error).toHaveBeenCalledWith("Only an administrator can delete a record.");
  });
});

describe("useMember and usePerson", () => {
  it("finds an active member, an archived member, and nobody for an unknown id", () => {
    const snapshot = seedSnapshot();
    const archived = snapshot.people.find((person) => person.id === "person_2")!;
    archived.member = { ...archived.member!, status: "archived" };
    seedChurch({ snapshot });

    expect(renderHook(() => useMember("person_1")).result.current?.person.firstName).toBe("Stephen");
    expect(renderHook(() => useMember("person_2")).result.current?.status).toBe("archived");
    expect(renderHook(() => useMember("person_missing")).result.current).toBeUndefined();
  });

  it("finds any person, member or visitor", () => {
    const snapshot = seedChurch();
    const visitor = snapshot.people.find((person) => person.kind === "visitor")!;

    expect(renderHook(() => usePerson("person_3")).result.current?.lastName).toBe("Balogun");
    expect(renderHook(() => usePerson(visitor.id)).result.current?.kind).toBe("visitor");
    expect(renderHook(() => usePerson("person_missing")).result.current).toBeUndefined();
  });
});
