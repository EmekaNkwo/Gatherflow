import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEAM_IDS } from "@/data/seed";
import { downloadCsv } from "@/lib/csv";
import {
  acceptCommands,
  freezeTime,
  invoke,
  lastCommand,
  refuseCommands,
  resetHarness,
  seedChurch,
  toastMock,
} from "@/tests/hooks-harness";
import { isAwaitingAssignment } from "@/services/visitors/pipeline";
import * as client from "@/services/commands/client";
import { err } from "@/lib/result";
import { useVisitor, useVisitorActionGate, useVisitors } from "./useVisitors";

vi.mock("@/services/commands/client");
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));
vi.mock("@/lib/csv", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/csv")>()),
  downloadCsv: vi.fn(),
}));

beforeEach(() => {
  freezeTime();
  // A stale refusal makes the store re-read the church; answer that quietly.
  vi.mocked(client.fetchChurch).mockResolvedValue(err("Offline in tests.", "network"));
});
afterEach(resetHarness);

describe("useVisitors data", () => {
  it("lists every visitor record, newest first visit first, with matching counts", () => {
    const snapshot = seedChurch();
    const { result } = renderHook(() => useVisitors());

    const visitors = snapshot.people.filter((person) => person.visitor);
    expect(result.current.rows).toHaveLength(visitors.length);
    const firstVisits = result.current.rows.map((row) => row.firstVisit);
    expect(firstVisits).toEqual([...firstVisits].sort().reverse());

    expect(result.current.counts.total).toBe(visitors.length);
    expect(result.current.counts.awaitingAssignment).toBe(
      visitors.filter((person) => !person.visitor?.assignedTo && !person.visitor?.closure).length,
    );
    expect(result.current.counts.optedOut).toBe(1);
    expect(result.current.counts.overdue).toBe(result.current.rows.filter((row) => row.hasOverdue).length);
    expect(result.current.counts.overdue).toBeGreaterThan(0);
  });

  it("narrows rows and counts by the query", () => {
    seedChurch();
    const { result } = renderHook(() => useVisitors({ assigneeId: "unassigned" }));

    expect(result.current.rows.length).toBeGreaterThan(0);
    expect(result.current.rows.every((row) => !row.person.visitor?.assignedTo)).toBe(true);
    expect(result.current.counts.total).toBe(result.current.rows.length);
  });

  it("builds the pipeline board in stage order", () => {
    seedChurch();
    const { result } = renderHook(() => useVisitors());

    expect(result.current.board.map((column) => column.stage.id)).toEqual([
      "new_visitor",
      "contact_pending",
      "contact_attempted",
      "contacted",
      "invited_to_return",
      "returned",
      "membership_orientation",
      "connected",
      "closed",
    ]);
    expect(result.current.stages[0].id).toBe("new_visitor");
    const boardTotal = result.current.board.reduce((sum, column) => sum + column.rows.length, 0);
    expect(boardTotal).toBe(result.current.rows.length);
  });

  it("finds a likely duplicate of an existing person", () => {
    const snapshot = seedChurch();
    const existing = snapshot.people.find((person) => person.kind === "visitor" && person.phone)!;
    const { result } = renderHook(() => useVisitors());

    const matches = result.current.findDuplicates({
      firstName: existing.firstName,
      lastName: existing.lastName,
      phone: existing.phone,
    });

    expect(matches.map((match) => match.person.id)).toContain(existing.id);
  });

  it("exports the given rows as a dated CSV file", () => {
    seedChurch();
    const { result } = renderHook(() => useVisitors());

    result.current.exportCsv(result.current.rows.slice(0, 2));

    expect(downloadCsv).toHaveBeenCalledTimes(1);
    const [filename, csv] = vi.mocked(downloadCsv).mock.calls[0];
    expect(filename).toBe("gatherflow-visitors-2026-10-12.csv");
    expect(csv.trim().split("\n")).toHaveLength(3);
  });

  it("exports every row by default", () => {
    seedChurch();
    const { result } = renderHook(() => useVisitors());

    result.current.exportCsv();

    const csv = vi.mocked(downloadCsv).mock.calls[0][1];
    expect(csv.trim().split("\n")).toHaveLength(result.current.rows.length + 1);
  });
});

describe("useVisitors actions", () => {
  beforeEach(() => {
    seedChurch({ role: "follow_up_coordinator", teamMemberId: TEAM_IDS.coordinator });
    acceptCommands({ notices: ["Saved."] });
  });

  type Hook = ReturnType<typeof useVisitors>;
  const cases: Array<[string, (hook: Hook) => Promise<unknown>, string, unknown]> = [
    [
      "register",
      (hook) => hook.register({ firstName: "Ada", lastName: "Obi" } as never),
      "visitor.register",
      { firstName: "Ada", lastName: "Obi" },
    ],
    [
      "assign",
      (hook) => hook.assign("person_120", TEAM_IDS.volunteerAmara),
      "visitor.assign",
      { personId: "person_120", assigneeId: TEAM_IDS.volunteerAmara },
    ],
    [
      "moveToStage",
      (hook) => hook.moveToStage("person_120", "contacted"),
      "visitor.setStage",
      { personId: "person_120", stageId: "contacted" },
    ],
    [
      "stopFollowUp",
      (hook) => hook.stopFollowUp("person_120", "contact_declined", "Asked us to stop", true),
      "visitor.closeFollowUp",
      { personId: "person_120", reason: "contact_declined", note: "Asked us to stop", optOut: true },
    ],
    [
      "updateContactPreferences",
      (hook) => hook.updateContactPreferences("person_120", { preferredMethod: "email", optedOut: false }),
      "visitor.setContactPreferences",
      { personId: "person_120", preferredMethod: "email", optedOut: false },
    ],
    [
      "expressMembershipInterest",
      (hook) => hook.expressMembershipInterest("person_120"),
      "visitor.recordMembershipInterest",
      { personId: "person_120" },
    ],
    [
      "recordAnotherVisit",
      (hook) => hook.recordAnotherVisit("person_120", "session_14"),
      "visitor.recordReturnVisit",
      { personId: "person_120", sessionId: "session_14" },
    ],
    [
      "bulkAssign",
      (hook) => hook.bulkAssign(["person_120", "person_121"], TEAM_IDS.volunteerTunde),
      "visitor.bulkAssign",
      { personIds: ["person_120", "person_121"], assigneeId: TEAM_IDS.volunteerTunde },
    ],
    [
      "bulkCreateTasks",
      (hook) => hook.bulkCreateTasks(["person_120"], { type: "phone_call" } as never),
      "task.createForPeople",
      { personIds: ["person_120"], input: { type: "phone_call" } },
    ],
  ];

  it.each(cases)("%s dispatches the matching command", async (_label, action, name, input) => {
    const { result } = renderHook(() => useVisitors());
    const outcome = await invoke(() => action(result.current));

    expect(lastCommand()).toEqual({ name, input });
    expect(outcome).toMatchObject({ ok: true });
    expect(toastMock.success).toHaveBeenCalledWith("Saved.", { description: undefined });
  });

  it("returns a refusal such as an opted-out visitor", async () => {
    refuseCommands("This visitor has opted out.", "opted_out");
    const { result } = renderHook(() => useVisitors());

    const outcome = await invoke(() => result.current.assign("person_137", TEAM_IDS.volunteerAmara));

    expect(outcome).toEqual({ ok: false, error: "This visitor has opted out.", code: "opted_out" });
    expect(toastMock.error).toHaveBeenCalledWith("This visitor has opted out.");
  });
});

describe("useVisitor", () => {
  it("finds one visitor's row and nothing for a member without a visitor record", () => {
    const snapshot = seedChurch();
    const visitor = snapshot.people.find((person) => person.kind === "visitor")!;
    const member = snapshot.people.find((person) => person.kind === "member" && !person.visitor)!;

    const { result } = renderHook(() => useVisitor(visitor.id));
    expect(result.current?.person.id).toBe(visitor.id);
    expect(result.current?.firstVisit).toBe(visitor.visitor?.firstVisitDate);

    const { result: missing } = renderHook(() => useVisitor(member.id));
    expect(missing.current).toBeUndefined();
  });
});

describe("audit fixes: counts and what each visitor offers", () => {
  it("counts awaiting assignment with the shared rule, leaving out the settled and members (M1)", () => {
    const snapshot = seedChurch();
    const { result } = renderHook(() => useVisitors());
    expect(result.current.counts.awaitingAssignment).toBe(
      snapshot.people.filter((person) => isAwaitingAssignment(snapshot.settings, person)).length,
    );
    expect(result.current.counts.becameMembers).toBe(
      snapshot.people.filter((person) => person.visitor && person.member).length,
    );
  });

  it("offers a volunteer no stop or assign on somebody else's visitor (H3, M6)", () => {
    const snapshot = seedChurch({ role: "volunteer", teamMemberId: TEAM_IDS.volunteerAmara });
    const theirs = snapshot.people.find(
      (person) =>
        person.visitor?.assignedTo &&
        person.visitor.assignedTo !== TEAM_IDS.volunteerAmara &&
        !snapshot.tasks.some((task) => task.personId === person.id && task.assigneeId === TEAM_IDS.volunteerAmara),
    )!;
    const { result } = renderHook(() => useVisitorActionGate());
    expect(result.current("stop", theirs)).toBe(false);
    expect(result.current("assign", theirs)).toBe(false);
    expect(result.current("preferences", theirs)).toBe(false);
  });
});
