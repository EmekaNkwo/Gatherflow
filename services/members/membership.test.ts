import { describe, expect, it } from "vitest";
import { TEAM_IDS } from "@/data/seed/team";
import { unwrap } from "@/lib/result";
import { runAutomations } from "@/services/automation/rules";
import { addGroupMember } from "@/services/groups/groups";
import { correctPerson, deletePerson } from "@/services/people/people";
import {
  attendance,
  ctx,
  group,
  member,
  session,
  snapshot,
  task,
  visitor,
} from "@/tests/factories";
import {
  changeMembershipStatus,
  recordMembershipInterest,
  registerMember,
} from "./membership";
import { selectMembers } from "./selectors";

describe("registerMember", () => {
  it("converts a visitor while keeping their id and history", () => {
    const data = snapshot({
      people: [visitor()],
      sessions: [session()],
      attendance: [attendance()],
      tasks: [task({ status: "completed", outcome: "contacted" })],
    });

    const outcome = unwrap(
      registerMember(data, { personId: "person_visitor", membershipDate: "2026-10-12" }, ctx()),
    );

    const person = outcome.snapshot.people[0];
    expect(person.id).toBe("person_visitor");
    expect(person.kind).toBe("member");
    expect(person.member?.reference).toBe("MEM-0001");
    expect(person.member?.status).toBe("new_member");
    // The visitor profile is kept, so the journey is not lost.
    expect(person.visitor?.firstVisitDate).toBe("2026-10-04");
    expect(outcome.snapshot.attendance).toHaveLength(1);
    expect(outcome.snapshot.tasks).toHaveLength(1);
    expect(outcome.events).toEqual([{ type: "member.registered", personId: "person_visitor" }]);
  });

  it("does not require earlier milestones", () => {
    // A visitor still in "new visitor" can be registered as a member.
    const outcome = unwrap(
      registerMember(
        snapshot({ people: [visitor()] }),
        { personId: "person_visitor", membershipDate: "2026-10-12" },
        ctx(),
      ),
    );

    expect(outcome.snapshot.people[0].member).toBeDefined();
    expect(outcome.snapshot.people[0].visitor?.stageId).toBe("membership_orientation");
  });

  it("refuses to register an existing member twice", () => {
    const outcome = registerMember(
      snapshot({ people: [member()] }),
      { personId: "person_member", membershipDate: "2026-10-12" },
      ctx(),
    );

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("duplicate");
  });

  it("creates a brand-new member record with the next reference", () => {
    const outcome = unwrap(
      registerMember(
        snapshot({ people: [member()] }),
        { firstName: "Ada", lastName: "Eze", membershipDate: "2026-10-12" },
        ctx(),
      ),
    );

    expect(outcome.snapshot.people).toHaveLength(2);
    expect(outcome.snapshot.people[1].member?.reference).toBe("MEM-0002");
  });

  it("needs a name when there is no existing record", () => {
    const outcome = registerMember(
      snapshot(),
      { firstName: "Ada", membershipDate: "2026-10-12" },
      ctx(),
    );
    expect(outcome.ok).toBe(false);
  });
});

describe("changeMembershipStatus", () => {
  it("appends to the status history with a reason", () => {
    const outcome = unwrap(
      changeMembershipStatus(
        snapshot({ people: [member()] }),
        "person_member",
        "inactive",
        "No attendance recorded for 10 weeks",
        ctx(),
      ),
    );

    const history = outcome.snapshot.people[0].member?.statusHistory ?? [];
    expect(history).toHaveLength(2);
    expect(history[1]).toMatchObject({
      status: "inactive",
      changedBy: TEAM_IDS.coordinator,
      reason: "No attendance recorded for 10 weeks",
    });
  });

  it("refuses a change to the current status", () => {
    const outcome = changeMembershipStatus(
      snapshot({ people: [member()] }),
      "person_member",
      "active",
      undefined,
      ctx(),
    );

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("unchanged");
  });

  it("never changes a status on its own: absence only flags a review", () => {
    const absent = member({
      member: { ...member().member!, status: "active" },
    });
    const data = snapshot({
      people: [absent],
      sessions: [session({ date: "2026-06-01" })],
      attendance: [attendance({ personId: "person_member", firstVisit: false })],
    });

    const rows = selectMembers(data, { filter: "needs_review" }, new Date("2026-10-12T09:00:00Z"));
    expect(rows).toHaveLength(1);
    expect(rows[0].person.member?.status).toBe("active");
    expect(rows[0].reviewReason).toContain("review threshold is 8");
  });
});

describe("membership interest", () => {
  it("records the interest and triggers the orientation rule once", () => {
    const context = ctx();
    const recorded = unwrap(
      recordMembershipInterest(snapshot({ people: [visitor()] }), "person_visitor", context),
    );

    expect(recorded.snapshot.people[0].visitor?.membershipInterestAt).toBe(
      "2026-10-12T09:00:00.000Z",
    );

    const automated = runAutomations(recorded.snapshot, recorded.events, context);
    expect(automated.snapshot.tasks).toHaveLength(1);
    expect(automated.snapshot.tasks[0].type).toBe("membership_orientation");
    expect(automated.snapshot.tasks[0].assigneeId).toBe(TEAM_IDS.admin);

    const replayed = runAutomations(automated.snapshot, recorded.events, context);
    expect(replayed.snapshot.tasks).toHaveLength(1);
  });

  it("will not record interest twice", () => {
    const interested = visitor({
      visitor: { ...visitor().visitor!, membershipInterestAt: "2026-10-01T09:00:00.000Z" },
    });
    const outcome = recordMembershipInterest(
      snapshot({ people: [interested] }),
      "person_visitor",
      ctx(),
    );

    expect(outcome.ok).toBe(false);
  });
});

describe("group assignment", () => {
  it("records who added the person and marks the visitor as connected", () => {
    const data = snapshot({ people: [visitor()], groups: [group()] });
    const outcome = unwrap(addGroupMember(data, "group_connect", "person_visitor", "member", ctx()));

    expect(outcome.snapshot.groups[0].members[0]).toMatchObject({
      personId: "person_visitor",
      addedBy: TEAM_IDS.coordinator,
    });
    expect(outcome.snapshot.people[0].groupIds).toEqual(["group_connect"]);
    expect(outcome.snapshot.people[0].visitor?.stageId).toBe("connected");
  });

  it("refuses to add the same person twice", () => {
    const data = snapshot({
      people: [visitor()],
      groups: [
        group({
          members: [
            { personId: "person_visitor", joinedAt: "2026-10-01T09:00:00.000Z", addedBy: TEAM_IDS.admin },
          ],
        }),
      ],
    });

    const outcome = addGroupMember(data, "group_connect", "person_visitor", "member", ctx());
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("duplicate");
  });

  it("refuses to add anyone to an inactive group", () => {
    const data = snapshot({ people: [visitor()], groups: [group({ active: false })] });
    const outcome = addGroupMember(data, "group_connect", "person_visitor", "member", ctx());
    expect(outcome.ok).toBe(false);
  });
});

describe("record correction and deletion", () => {
  it("applies a correction and logs what changed", () => {
    const outcome = unwrap(
      correctPerson(
        snapshot({ people: [member()] }),
        "person_member",
        { phone: "+44 7700 900333", preferredName: "Gracie" },
        ctx(),
      ),
    );

    expect(outcome.snapshot.people[0].phone).toBe("+44 7700 900333");
    expect(outcome.snapshot.people[0].preferredName).toBe("Gracie");
    expect(outcome.snapshot.activity[0].summary).toContain("phone");
  });

  it("refuses to blank out a required name", () => {
    const outcome = correctPerson(
      snapshot({ people: [member()] }),
      "person_member",
      { firstName: "   " },
      ctx(),
    );
    expect(outcome.ok).toBe(false);
  });

  it("deletes the person and everything attached to them", () => {
    const data = snapshot({
      people: [visitor()],
      sessions: [session()],
      attendance: [attendance()],
      tasks: [task()],
      groups: [
        group({
          leaderId: "person_visitor",
          members: [
            { personId: "person_visitor", joinedAt: "2026-10-01T09:00:00.000Z", addedBy: TEAM_IDS.admin },
          ],
        }),
      ],
      communications: [
        {
          id: "comm_1",
          personId: "person_visitor",
          channel: "whatsapp",
          status: "opened_external",
          body: "Hello",
          at: "2026-10-06T09:00:00.000Z",
          actorId: TEAM_IDS.coordinator,
          simulated: true,
        },
      ],
    });

    const outcome = unwrap(
      deletePerson(data, "person_visitor", "Asked for their record to be removed", ctx()),
    );

    expect(outcome.snapshot.people).toHaveLength(0);
    expect(outcome.snapshot.attendance).toHaveLength(0);
    expect(outcome.snapshot.tasks).toHaveLength(0);
    expect(outcome.snapshot.communications).toHaveLength(0);
    expect(outcome.snapshot.groups[0].members).toHaveLength(0);
    expect(outcome.snapshot.groups[0].leaderId).toBeUndefined();
    // The audit entry must not carry the person's details.
    expect(outcome.snapshot.activity[0].summary).not.toContain("Tunde");
  });
});
