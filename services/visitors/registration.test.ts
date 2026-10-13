import { describe, expect, it } from "vitest";
import { TEAM_IDS } from "@/data/seed/team";
import { unwrap } from "@/lib/result";
import { runAutomations } from "@/services/automation/rules";
import { ctx, session, snapshot, TODAY, visitor } from "@/tests/factories";
import { registerVisitor } from "./registration";
import { findPotentialDuplicates } from "./duplicates";

describe("registerVisitor", () => {
  it("creates a visitor record with the first stage and no assignment", () => {
    const outcome = unwrap(
      registerVisitor(
        snapshot(),
        {
          firstName: "Ada",
          lastName: "Eze",
          phone: "+44 7700 900123",
          visitDate: TODAY,
          source: "invitation",
          preferredMethod: "whatsapp",
          permissionGranted: true,
        },
        ctx(),
      ),
    );

    const person = outcome.snapshot.people[0];
    expect(person.kind).toBe("visitor");
    expect(person.visitor?.stageId).toBe("new_visitor");
    expect(person.visitor?.assignedTo).toBeUndefined();
    expect(person.visitor?.contactAttempts).toBe(0);
    expect(outcome.events).toEqual([
      { type: "visitor.registered", personId: person.id, firstVisitDate: TODAY },
    ]);
  });

  it("moves straight to contact pending when a volunteer is assigned", () => {
    const outcome = unwrap(
      registerVisitor(
        snapshot(),
        {
          firstName: "Ada",
          lastName: "Eze",
          visitDate: TODAY,
          source: "walk_in",
          preferredMethod: "phone",
          permissionGranted: true,
          assignedTo: TEAM_IDS.volunteerAmara,
        },
        ctx(),
      ),
    );

    expect(outcome.snapshot.people[0].visitor?.stageId).toBe("contact_pending");
  });

  it("requires a first and last name", () => {
    const outcome = registerVisitor(
      snapshot(),
      {
        firstName: "  ",
        lastName: "Eze",
        visitDate: TODAY,
        source: "walk_in",
        preferredMethod: "phone",
        permissionGranted: true,
      },
      ctx(),
    );

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("invalid");
  });

  it("records attendance for the session so the visit count is real", () => {
    const base = snapshot({ sessions: [session()] });
    const outcome = unwrap(
      registerVisitor(
        base,
        {
          firstName: "Ada",
          lastName: "Eze",
          visitDate: "2026-10-11",
          sessionId: "session_sunday",
          source: "walk_in",
          preferredMethod: "phone",
          permissionGranted: true,
        },
        ctx(),
      ),
    );

    expect(outcome.snapshot.attendance).toHaveLength(1);
    expect(outcome.snapshot.attendance[0].firstVisit).toBe(true);
    expect(outcome.snapshot.attendance[0].method).toBe("new_visitor");
  });

  it("marks self-registration from the public welcome page", () => {
    const outcome = unwrap(
      registerVisitor(
        snapshot({ sessions: [session()] }),
        {
          firstName: "Ada",
          lastName: "Eze",
          visitDate: "2026-10-11",
          sessionId: "session_sunday",
          source: "online",
          preferredMethod: "email",
          permissionGranted: false,
          selfRegistered: true,
        },
        ctx(),
      ),
    );

    expect(outcome.snapshot.attendance[0].method).toBe("self_registration");
    expect(outcome.snapshot.activity[0].type).toBe("visitor.self_registered");
    expect(outcome.notices).toContain(
      "No contact permission was given, so no messages will be drafted.",
    );
  });
});

describe("first-visit automation", () => {
  it("creates exactly one welcome task, whatever happens to the event", () => {
    const context = ctx();
    const registered = unwrap(
      registerVisitor(
        snapshot(),
        {
          firstName: "Ada",
          lastName: "Eze",
          visitDate: TODAY,
          source: "invitation",
          preferredMethod: "whatsapp",
          permissionGranted: true,
        },
        context,
      ),
    );

    const once = runAutomations(registered.snapshot, registered.events, context);
    expect(once.snapshot.tasks).toHaveLength(1);
    expect(once.snapshot.tasks[0].type).toBe("welcome_message");
    expect(once.snapshot.tasks[0].origin).toBe("rule:first_visit_welcome");
    expect(once.snapshot.tasks[0].assigneeId).toBe(TEAM_IDS.coordinator);

    // Replaying the same event must not produce a second task.
    const twice = runAutomations(once.snapshot, registered.events, context);
    expect(twice.snapshot.tasks).toHaveLength(1);
  });

  it("does not create a task for someone who has opted out", () => {
    const optedOut = visitor({
      contact: {
        preferredMethod: "phone",
        permissionGranted: false,
        optedOut: true,
        optedOutAt: "2026-10-05T09:00:00.000Z",
      },
    });

    const context = ctx();
    const outcome = runAutomations(
      snapshot({ people: [optedOut] }),
      [{ type: "visitor.registered", personId: optedOut.id, firstVisitDate: "2026-10-04" }],
      context,
    );

    expect(outcome.snapshot.tasks).toHaveLength(0);
    expect(outcome.notices.join(" ")).toContain("asked not to be contacted");
  });

  it("respects a disabled rule", () => {
    const base = snapshot({
      people: [visitor()],
      settings: {
        ...snapshot().settings,
        automationRules: snapshot().settings.automationRules.map((rule) =>
          rule.id === "first_visit_welcome" ? { ...rule, enabled: false } : rule,
        ),
      },
    });

    const outcome = runAutomations(
      base,
      [{ type: "visitor.registered", personId: "person_visitor", firstVisitDate: "2026-10-04" }],
      ctx(),
    );

    expect(outcome.snapshot.tasks).toHaveLength(0);
  });
});

describe("duplicate suggestions", () => {
  const people = [
    visitor(),
    visitor({
      id: "person_other",
      firstName: "Tunde",
      lastName: "Balogun",
      phone: "+44 7700 900999",
      email: undefined,
    }),
  ];

  it("flags the same phone number as a high-confidence match", () => {
    const matches = findPotentialDuplicates(people, {
      firstName: "Different",
      lastName: "Name",
      phone: "07700900111",
    });

    expect(matches[0]).toMatchObject({ confidence: "high", reason: "Same phone number" });
  });

  it("flags the same email address", () => {
    const matches = findPotentialDuplicates(people, {
      firstName: "Someone",
      lastName: "Else",
      email: "TUNDE.BALOGUN@example.com ",
    });

    expect(matches[0]?.reason).toBe("Same email address");
  });

  it("flags a near-identical name as medium confidence", () => {
    const matches = findPotentialDuplicates(people, {
      firstName: "Tunda",
      lastName: "Balogun",
    });

    expect(matches[0]?.confidence).toBe("medium");
  });

  it("excludes the record being edited", () => {
    const matches = findPotentialDuplicates(people, {
      firstName: "Tunde",
      lastName: "Balogun",
      phone: "+44 7700 900111",
      excludeId: "person_visitor",
    });

    expect(matches.every((match) => match.person.id !== "person_visitor")).toBe(true);
  });

  it("returns nothing when there is nothing to compare", () => {
    expect(findPotentialDuplicates(people, { firstName: "", lastName: "" })).toEqual([]);
  });
});
