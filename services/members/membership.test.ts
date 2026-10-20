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
  NOW,
  session,
  snapshot,
  task,
  visitor,
} from "@/tests/factories";
import {
  DUPLICATE_WINDOW_MINUTES,
  changeMembershipStatus,
  recordMembershipInterest,
  recordOrientationCompleted,
  registerMember,
  setEmergencyContact,
  setRequestedContact,
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

describe("registerMember edge cases", () => {
  it("keeps existing contact details unless new ones are given, and sets the household", () => {
    const outcome = unwrap(
      registerMember(
        snapshot({
          people: [visitor()],
          households: [{ id: "h1", name: "Balogun household", createdAt: "2024-01-01T00:00:00.000Z" }],
        }),
        { personId: "person_visitor", membershipDate: "2026-10-12", phone: "  ", email: " new@example.com ", householdId: "h1" },
        ctx(),
      ),
    );
    const person = outcome.snapshot.people[0];
    expect(person.phone).toBe("+44 7700 900111");
    expect(person.email).toBe("new@example.com");
    expect(person.householdId).toBe("h1");
    expect(person.visitor?.stageId).toBe("membership_orientation");
    expect(outcome.events).toEqual([{ type: "member.registered", personId: "person_visitor" }]);
  });

  it("leaves a visitor's stage alone when it cannot advance", () => {
    const closed = visitor({ visitor: { ...visitor().visitor!, stageId: "closed" } });
    const outcome = unwrap(
      registerMember(snapshot({ people: [closed] }), { personId: "person_visitor", membershipDate: "2026-10-12" }, ctx()),
    );
    expect(outcome.snapshot.people[0].visitor?.stageId).toBe("closed");
    expect(outcome.snapshot.people[0].visitor?.stageUpdatedAt).toBe(closed.visitor!.stageUpdatedAt);
  });

  it("refuses an unknown person id", () => {
    const outcome = registerMember(snapshot(), { personId: "nobody", membershipDate: "2026-10-12" }, ctx());
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("not_found");
  });

  it("defaults a new member's contact preferences and trims optional fields", () => {
    const outcome = unwrap(
      registerMember(
        snapshot(),
        { firstName: " Ada ", lastName: " Okafor ", preferredName: " ", phone: "", membershipDate: "2026-10-12" },
        ctx(),
      ),
    );
    const person = outcome.snapshot.people[0];
    expect(person).toMatchObject({ firstName: "Ada", lastName: "Okafor", preferredName: undefined, phone: undefined });
    expect(person.contact).toEqual({ preferredMethod: "phone", permissionGranted: true, optedOut: false });
    expect(outcome.personId).toBe(person.id);
  });
});

describe("recordMembershipInterest refusals", () => {
  it.each([
    ["an unknown person", [visitor()], "nobody", "not_found"],
    ["an existing member", [member()], "person_member", "duplicate"],
    [
      "a person with neither profile",
      [{ ...member(), member: undefined }],
      "person_member",
      "invalid",
    ],
  ])("refuses %s", (_label, people, personId, code) => {
    const outcome = recordMembershipInterest(snapshot({ people }), personId, ctx());
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe(code);
  });
});

describe("changeMembershipStatus summaries", () => {
  it("omits the dash when no reason is given", () => {
    const outcome = unwrap(changeMembershipStatus(snapshot({ people: [member()] }), "person_member", "inactive", undefined, ctx()));
    expect(outcome.snapshot.activity[0].summary).toBe("Grace Adeyemi's membership status changed to inactive.");
    expect(outcome.notices).toEqual(["Status updated to Inactive."]);
  });

  it("refuses a visitor without a member record", () => {
    const outcome = changeMembershipStatus(snapshot({ people: [visitor()] }), "person_visitor", "active", "x", ctx());
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("not_found");
  });
});

describe("recordOrientationCompleted", () => {
  it("adds a timeline entry without changing the person", () => {
    const input = snapshot({ people: [visitor()] });
    const outcome = unwrap(recordOrientationCompleted(input, "person_visitor", ctx()));
    expect(outcome.snapshot.people).toBe(input.people);
    expect(outcome.snapshot.activity[0]).toMatchObject({
      type: "membership.orientation_completed",
      personId: "person_visitor",
      summary: "Tunde Balogun completed membership orientation.",
    });
    expect(outcome.notices).toEqual(["Membership orientation recorded."]);
  });

  it("refuses an unknown person", () => {
    const outcome = recordOrientationCompleted(snapshot(), "nobody", ctx());
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("not_found");
  });
});

describe("setEmergencyContact", () => {
  const contact = { name: "Femi Adeyemi", relationship: "Brother", phone: "07700 900999" };

  it("saves and clears the restricted contact", () => {
    const input = snapshot({ people: [member()] });
    const saved = unwrap(setEmergencyContact(input, "person_member", contact, ctx()));
    expect(saved.snapshot.people[0].member?.emergencyContact).toEqual(contact);
    expect(saved.notices).toEqual(["Emergency contact saved."]);
    expect(saved.snapshot.activity).toEqual([]);
    expect(input.people[0].member?.emergencyContact).toBeUndefined();

    const cleared = unwrap(setEmergencyContact(saved.snapshot, "person_member", undefined, ctx()));
    expect(cleared.snapshot.people[0].member?.emergencyContact).toBeUndefined();
  });

  it("refuses a visitor", () => {
    const outcome = setEmergencyContact(snapshot({ people: [visitor()] }), "person_visitor", contact, ctx());
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("not_found");
  });
});

describe("setRequestedContact", () => {
  it.each([
    [true, "Marked as requesting contact."],
    [false, "Contact request cleared."],
  ])("sets requestedContact=%s", (requested, notice) => {
    const outcome = unwrap(setRequestedContact(snapshot({ people: [member()] }), "person_member", requested, ctx()));
    expect(outcome.snapshot.people[0].member?.requestedContact).toBe(requested);
    expect(outcome.notices).toEqual([notice]);
  });

  it("refuses an unknown person", () => {
    const outcome = setRequestedContact(snapshot(), "nobody", true, ctx());
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("not_found");
  });
});

describe("registerMember duplicate guard (H2)", () => {
  const input = {
    firstName: "Chloé",
    lastName: "O'Brien",
    phone: "07700 900123",
    membershipDate: "2026-10-12",
  };

  it("refuses the same name and contact details sent twice within minutes", () => {
    const first = unwrap(registerMember(snapshot(), input, ctx()));
    const again = registerMember(
      first.snapshot,
      { ...input, firstName: "chloe", phone: "+44 7700 900123" },
      ctx({ now: new Date(NOW.getTime() + 60_000) }),
    );
    expect(again.ok).toBe(false);
    if (!again.ok) {
      expect(again.code).toBe("duplicate");
      expect(again.error).toContain("added a moment ago");
    }
    expect(first.snapshot.people).toHaveLength(1);
  });

  it("allows the same name with different contact details, or once the window has passed", () => {
    const first = unwrap(registerMember(snapshot(), input, ctx()));
    expect(registerMember(first.snapshot, { ...input, phone: "07700 900999" }, ctx()).ok).toBe(true);
    const later = new Date(NOW.getTime() + (DUPLICATE_WINDOW_MINUTES + 1) * 60_000);
    expect(registerMember(first.snapshot, input, ctx({ now: later })).ok).toBe(true);
  });
});

describe("registerMember closes visitor follow-up (H3)", () => {
  const tasks = [
    task({ id: "t_welcome", reference: "FU-0001", type: "welcome_message" }),
    task({ id: "t_orient", reference: "FU-0002", type: "membership_orientation" }),
    task({ id: "t_group", reference: "FU-0003", type: "group_invitation" }),
    task({ id: "t_done", reference: "FU-0004", type: "phone_call", status: "completed", outcome: "contacted" }),
  ];

  it("cancels open visitor tasks with a note and leaves group invitations open", () => {
    const data = snapshot({ people: [visitor()], tasks });
    const outcome = unwrap(
      registerMember(data, { personId: "person_visitor", membershipDate: "2026-10-12" }, ctx()),
    );
    const byId = new Map(outcome.snapshot.tasks.map((entry) => [entry.id, entry]));

    expect(byId.get("t_welcome")).toMatchObject({ status: "cancelled" });
    expect(byId.get("t_welcome")?.notes).toContain("they became a member");
    expect(byId.get("t_orient")).toMatchObject({ status: "cancelled" });
    expect(byId.get("t_group")).toMatchObject({ status: "pending" });
    expect(byId.get("t_done")).toMatchObject({ status: "completed" });
    expect(outcome.notices).toContain("2 visitor follow-up tasks closed, as they're now a member.");
    expect(
      outcome.snapshot.activity.filter((entry) => entry.type === "follow_up.cancelled"),
    ).toHaveLength(2);
  });

  it("completes the orientation task when orientation was already recorded", () => {
    const data = snapshot({ people: [visitor()], tasks });
    const oriented = unwrap(recordOrientationCompleted(data, "person_visitor", ctx())).snapshot;
    const outcome = unwrap(
      registerMember(oriented, { personId: "person_visitor", membershipDate: "2026-10-12" }, ctx()),
    );
    const orientation = outcome.snapshot.tasks.find((entry) => entry.id === "t_orient");
    expect(orientation).toMatchObject({ status: "completed", completedBy: TEAM_IDS.coordinator });
  });
});

describe("registerMember household check (M4)", () => {
  it("refuses a household that doesn't exist, for new and converted members", () => {
    const fresh = registerMember(
      snapshot(),
      { firstName: "Bad", lastName: "House", membershipDate: "2026-10-12", householdId: "household_nope" },
      ctx(),
    );
    expect(fresh.ok).toBe(false);
    if (!fresh.ok) expect(fresh.code).toBe("not_found");

    const convert = registerMember(
      snapshot({ people: [visitor()] }),
      { personId: "person_visitor", membershipDate: "2026-10-12", householdId: "household_nope" },
      ctx(),
    );
    expect(convert.ok).toBe(false);
  });
});

describe("recordMembershipInterest moves the stage (M2)", () => {
  it("advances an earlier visitor to exploring membership", () => {
    const returned = visitor({ visitor: { ...visitor().visitor!, stageId: "returned" } });
    const outcome = unwrap(recordMembershipInterest(snapshot({ people: [returned] }), "person_visitor", ctx()));
    expect(outcome.snapshot.people[0].visitor).toMatchObject({
      stageId: "membership_orientation",
      stageUpdatedAt: NOW.toISOString(),
    });
    expect(outcome.events).toContainEqual({
      type: "visitor.stage_changed",
      personId: "person_visitor",
      stageId: "membership_orientation",
    });
  });

  it("never moves someone who is already further along backwards", () => {
    const connected = visitor({ visitor: { ...visitor().visitor!, stageId: "connected" } });
    const outcome = unwrap(recordMembershipInterest(snapshot({ people: [connected] }), "person_visitor", ctx()));
    expect(outcome.snapshot.people[0].visitor?.stageId).toBe("connected");
    expect(outcome.events).toEqual([{ type: "visitor.membership_interest", personId: "person_visitor" }]);
  });
});

describe("recordOrientationCompleted is recorded once (L1)", () => {
  it("refuses a second record with a clear message", () => {
    const once = unwrap(recordOrientationCompleted(snapshot({ people: [member()] }), "person_member", ctx()));
    const twice = recordOrientationCompleted(once.snapshot, "person_member", ctx());
    expect(twice.ok).toBe(false);
    if (!twice.ok) {
      expect(twice.code).toBe("unchanged");
      expect(twice.error).toBe("Orientation is already recorded for Grace Adeyemi.");
    }
  });
});
