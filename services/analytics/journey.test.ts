import { describe, expect, it } from "vitest";
import { TEAM_IDS } from "@/data/seed/team";
import { attendance, group, member, NOW, session, snapshot, task, visitor } from "@/tests/factories";
import type { ActivityEvent } from "@/types/activity";
import type { GroupMembership } from "@/types/group";
import type { Person } from "@/types/person";
import { defaultJourneyRange, journeyFor, journeyReport, latestMilestone } from "./journey";

const joined = (personId: string, joinedAt: string, role?: GroupMembership["role"]): GroupMembership => ({
  personId,
  joinedAt,
  addedBy: TEAM_IDS.coordinator,
  role,
});

const orientation: ActivityEvent = {
  id: "act_orientation",
  type: "membership.orientation_completed",
  category: "membership",
  personId: "person_visitor",
  summary: "Completed orientation",
  at: "2026-10-08T19:00:00.000Z",
  visibility: "general",
};

/** A visitor who has done everything, so every milestone is dated. */
function fullJourney() {
  const base = visitor();
  const converted: Person = {
    ...base,
    kind: "member",
    visitor: { ...base.visitor!, membershipInterestAt: "2026-10-07T10:00:00.000Z" },
    member: { ...member().member!, reference: "MEM-0042", statusHistory: [{ ...member().member!.statusHistory[0], changedAt: "2026-10-10T10:00:00.000Z" }] },
  };

  return snapshot({
    people: [converted],
    sessions: [
      session({ id: "s_late", name: "Harvest service", date: "2026-10-11" }),
      session({ id: "s_first", date: "2026-10-04" }),
    ],
    attendance: [
      attendance({ id: "a_late", sessionId: "s_late", firstVisit: false }),
      attendance({ id: "a_first", sessionId: "s_first" }),
      attendance({ id: "a_removed", sessionId: "s_first", status: "removed" }),
    ],
    tasks: [
      task({ id: "t_later", reference: "FU-0002", status: "completed", outcome: "contacted", completedAt: "2026-10-09T10:00:00.000Z" }),
      task({ id: "t_first", reference: "FU-0001", status: "completed", outcome: "contacted", completedAt: "2026-10-05T10:00:00.000Z" }),
      task({ id: "t_no_answer", reference: "FU-0003", status: "completed", outcome: "no_answer", completedAt: "2026-10-04T15:00:00.000Z" }),
    ],
    activity: [orientation],
    groups: [
      group({ id: "g_choir", name: "Choir", type: "choir", members: [joined("person_visitor", "2026-10-11T13:00:00.000Z")] }),
      group({ id: "g_connect", members: [joined("person_visitor", "2026-10-09T19:00:00.000Z", "member")] }),
    ],
  });
}

describe("journeyFor", () => {
  it("dates every milestone from its own record", () => {
    const milestones = journeyFor(fullJourney(), "person_visitor");
    expect(milestones.map((milestone) => [milestone.key, milestone.at, milestone.detail])).toEqual([
      ["first_visit", "2026-10-04T12:00:00.000Z", "Registered as a visitor"],
      ["follow_up_completed", "2026-10-05T10:00:00.000Z", "FU-0001 — successfully contacted"],
      ["second_visit", "2026-10-11T12:00:00.000Z", "Harvest service"],
      ["membership_interest", "2026-10-07T10:00:00.000Z", "Asked about becoming a member"],
      ["orientation_completed", "2026-10-08T19:00:00.000Z", "Attended membership orientation"],
      ["membership_confirmed", "2026-10-10T10:00:00.000Z", "Member MEM-0042"],
      ["group_joined", "2026-10-09T19:00:00.000Z", "Riverside Connect Group"],
      ["ministry_involvement", "2026-10-11T13:00:00.000Z", "Choir"],
    ]);
  });

  it("labels milestones and marks the optional ones", () => {
    const milestones = journeyFor(fullJourney(), "person_visitor");
    expect(milestones.filter((milestone) => milestone.optional).map((milestone) => milestone.key)).toEqual([
      "follow_up_completed",
      "membership_interest",
      "orientation_completed",
      "group_joined",
      "ministry_involvement",
    ]);
    expect(milestones[0].label).toBe("First visit");
  });

  it("counts leading a connect group as ministry involvement", () => {
    const data = snapshot({
      people: [visitor()],
      groups: [group({ members: [joined("person_visitor", "2026-10-09T19:00:00.000Z", "leader")] })],
    });
    const ministry = journeyFor(data, "person_visitor").find((milestone) => milestone.key === "ministry_involvement")!;
    expect(ministry.at).toBe("2026-10-09T19:00:00.000Z");
    expect(ministry.detail).toBe("Riverside Connect Group");
  });

  it("uses the first recorded attendance for someone who was never a visitor", () => {
    const data = snapshot({
      people: [member()],
      sessions: [session({ id: "s2", date: "2026-10-11" }), session({ id: "s1", date: "2026-09-27" })],
      attendance: [
        attendance({ id: "a2", sessionId: "s2", personId: "person_member" }),
        attendance({ id: "a1", sessionId: "s1", personId: "person_member" }),
      ],
    });
    const first = journeyFor(data, "person_member")[0];
    expect(first).toMatchObject({ at: "2026-09-27T12:00:00.000Z", detail: "First recorded attendance" });
  });

  it("leaves a member's first visit undated when attendance points at a missing session", () => {
    const data = snapshot({ people: [member()], attendance: [attendance({ personId: "person_member", sessionId: "gone" })] });
    const milestones = journeyFor(data, "person_member");
    expect(milestones[0]).toMatchObject({ at: undefined, detail: undefined });
    expect(milestones.find((milestone) => milestone.key === "second_visit")?.at).toBeUndefined();
  });

  it("returns nothing for an unknown person", () => {
    expect(journeyFor(fullJourney(), "nobody")).toEqual([]);
  });
});

describe("latestMilestone", () => {
  it("returns the most recent dated milestone", () => {
    expect(latestMilestone(fullJourney(), "person_visitor")?.key).toBe("ministry_involvement");
    const data = snapshot({ people: [visitor()] });
    expect(latestMilestone(data, "person_visitor")).toMatchObject({ key: "first_visit", at: "2026-10-04T12:00:00.000Z" });
  });

  it("is undefined when nothing is dated", () => {
    const undated = member({ member: { ...member().member!, statusHistory: [] } });
    expect(latestMilestone(snapshot({ people: [undated] }), "person_member")).toBeUndefined();
    expect(latestMilestone(snapshot(), "nobody")).toBeUndefined();
  });
});

describe("journeyReport", () => {
  it("includes both ends of the range and counts closures and group joins", () => {
    const base = visitor().visitor!;
    const data = snapshot({
      people: [
        visitor({ id: "start", visitor: { ...base, firstVisitDate: "2026-09-01" }, groupIds: ["g1"] }),
        visitor({
          id: "end",
          visitor: { ...base, firstVisitDate: "2026-09-30", closure: { reason: "paused", recordedAt: "2026-10-01T00:00:00.000Z" } },
        }),
        visitor({ id: "interest", visitor: { ...base, firstVisitDate: "2026-09-15", membershipInterestAt: "2026-09-20T00:00:00.000Z" } }),
        visitor({ id: "before", visitor: { ...base, firstVisitDate: "2026-08-31" } }),
        member(),
      ],
    });
    const report = journeyReport(data, { from: "2026-09-01", to: "2026-09-30" });
    expect(report).toEqual({
      range: { from: "2026-09-01", to: "2026-09-30" },
      cohortSize: 3,
      firstTimeVisitors: 3,
      contacted: { numerator: 0, denominator: 3, percentage: 0 },
      returned: { numerator: 0, denominator: 3, percentage: 0 },
      requestedOrientation: { numerator: 1, denominator: 3, percentage: 33.3 },
      becameMembers: { numerator: 0, denominator: 3, percentage: 0 },
      joinedGroup: { numerator: 1, denominator: 3, percentage: 33.3 },
      closed: 1,
    });
  });
});

describe("defaultJourneyRange", () => {
  it("covers the last 90 days up to today", () => {
    expect(defaultJourneyRange(NOW)).toEqual({ from: "2026-07-14", to: "2026-10-12" });
  });
});
