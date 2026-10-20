import { describe, expect, it } from "vitest";
import { TEAM_IDS } from "@/data/seed/team";
import { can } from "@/lib/permissions";
import { unwrap } from "@/lib/result";
import { attendance, ctx, group, member, NOW, session, snapshot, task, visitor } from "@/tests/factories";
import type { ChurchSnapshot } from "@/types/snapshot";
import { DEMO_ROLES } from "@/types/team";
import {
  COMMAND_NAMES,
  COMMANDS,
  commandFor,
  isCommandName,
  type CommandName,
} from "./registry";

/**
 * The registry is the only place where a capability, an input shape and a
 * command are tied together, so these tests check that binding rather than any
 * one command's behaviour — the domain rules have their own tests.
 */
describe("command registry", () => {
  it("gives every command a capability, a schema and a function", () => {
    expect(COMMAND_NAMES.length).toBeGreaterThan(40);

    for (const name of COMMAND_NAMES) {
      const definition = commandFor(name);
      expect(definition.capability, name).toBeTruthy();
      expect(typeof definition.run, name).toBe("function");
      expect(definition.schema, name).toBeTruthy();
    }
  });

  it("only uses capabilities that some role actually has", () => {
    // A command requiring a capability nobody holds would be dead code that
    // looks like a feature.
    for (const name of COMMAND_NAMES) {
      const capability = commandFor(name).capability;
      const holders = DEMO_ROLES.filter((role) => can(role, capability));
      expect(holders.length, `${name} requires ${capability}`).toBeGreaterThan(0);
    }
  });

  it("puts every pastoral-care command behind care.write", () => {
    const careCommands = COMMAND_NAMES.filter((name) => name.startsWith("care."));
    expect(careCommands.length).toBeGreaterThan(0);
    for (const name of careCommands) {
      expect(commandFor(name).capability, name).toBe("care.write");
    }
  });

  it("puts creating, changing and deleting services behind sessions.manage", () => {
    for (const name of ["session.create", "session.update", "session.delete"] as const) {
      expect(commandFor(name).capability, name).toBe("sessions.manage");
    }
  });

  it("puts every settings command behind settings.write", () => {
    const settingsCommands = COMMAND_NAMES.filter((name) => name.startsWith("settings."));
    expect(settingsCommands.length).toBeGreaterThan(0);
    for (const name of settingsCommands) {
      expect(commandFor(name).capability, name).toBe("settings.write");
    }
  });

  it("recognises its own names and nothing else", () => {
    expect(isCommandName("task.create")).toBe(true);
    for (const value of ["", "task", "task.nope", "__proto__", "toString", 42, null]) {
      expect(isCommandName(value), String(value)).toBe(false);
    }
  });

  describe("input schemas", () => {
    it("refuses an unknown enum value", () => {
      const parsed = COMMANDS["task.create"].schema.safeParse({
        personId: "person-1",
        type: "not_a_real_type",
      });
      expect(parsed.success).toBe(false);
    });

    it("refuses a missing required field", () => {
      expect(COMMANDS["task.complete"].schema.safeParse({ taskId: "t1" }).success).toBe(
        false,
      );
      expect(
        COMMANDS["task.complete"].schema.safeParse({
          taskId: "t1",
          outcome: "contacted",
        }).success,
      ).toBe(true);
    });

    it("refuses an empty id", () => {
      expect(COMMANDS["task.start"].schema.safeParse({ taskId: "" }).success).toBe(false);
    });

    it("does not let a request forge an automation-generated task", () => {
      // `origin` and `automationKey` belong to the automation engine. If a
      // client could set them it could either fabricate a generated task or
      // occupy a key and so suppress the real one. They are absent from the
      // schema, and Zod drops what it was not told about.
      const parsed = COMMANDS["task.create"].schema.safeParse({
        personId: "person-1",
        type: "welcome_message",
        automationKey: "first_visit_welcome:person-1:2026-10-12",
        origin: "rule:first_visit_welcome",
      });

      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data).not.toHaveProperty("automationKey");
        expect(parsed.data).not.toHaveProperty("origin");
      }
    });

    it("bounds a bulk action's id list", () => {
      // An unbounded list would let one request rewrite the whole church.
      const tooMany = Array.from({ length: 501 }, (_, i) => `person-${i}`);
      expect(
        COMMANDS["visitor.bulkAssign"].schema.safeParse({
          personIds: tooMany,
          assigneeId: "tm-1",
        }).success,
      ).toBe(false);
      expect(
        COMMANDS["visitor.bulkAssign"].schema.safeParse({
          personIds: ["person-1"],
          assigneeId: "tm-1",
        }).success,
      ).toBe(true);
      expect(
        COMMANDS["visitor.bulkAssign"].schema.safeParse({
          personIds: [],
          assigneeId: "tm-1",
        }).success,
      ).toBe(false);
    });

    it("bounds free text so a request cannot store something unbounded", () => {
      const tooLong = "x".repeat(5_000);
      expect(
        COMMANDS["task.cancel"].schema.safeParse({ taskId: "t1", reason: tooLong })
          .success,
      ).toBe(false);
    });
  });

  it("covers every command the feature hooks invoke", async () => {
    // Guards against a hook calling a command that was never registered, which
    // would work in the browser and fail only once it reached the server.
    const expected: CommandName[] = [
      "visitor.register",
      "visitor.assign",
      "visitor.setStage",
      "visitor.closeFollowUp",
      "visitor.reopenFollowUp",
      "visitor.setContactPreferences",
      "visitor.recordMembershipInterest",
      "visitor.recordReturnVisit",
      "task.create",
      "task.complete",
      "task.reschedule",
      "task.assign",
      "task.start",
      "task.cancel",
      "task.createForPeople",
      "visitor.bulkAssign",
      "member.register",
      "member.changeStatus",
      "member.recordOrientationCompleted",
      "member.setEmergencyContact",
      "member.setRequestedContact",
      "person.correct",
      "person.delete",
      "person.setHousehold",
      "household.create",
      "session.create",
      "session.update",
      "session.delete",
      "session.updateNotes",
      "attendance.record",
      "attendance.remove",
      "attendance.move",
      "attendance.importCsv",
      "group.create",
      "group.addMember",
      "group.removeMember",
      "group.setLeader",
      "group.setActive",
      "communication.log",
      "communication.logMany",
      "template.create",
      "template.update",
      "template.delete",
      "care.create",
      "care.update",
      "care.addNote",
      "care.scheduleAppointment",
      "care.setAppointmentStatus",
      "settings.updateProfile",
      "settings.updateAutomationRule",
      "settings.updateEngagement",
      "settings.updatePipelineStages",
      "settings.updateServices",
      "settings.upsertTeamMember",
      "settings.setTeamMemberActive",
    ];

    for (const name of expected) {
      expect(isCommandName(name), name).toBe(true);
    }
  });
});

/**
 * The adapters that unpack a request body into a domain function's
 * positional arguments. Each case runs the command exactly as the server
 * does — parse with the schema, then run — and checks that the right field
 * reached the right argument.
 */
describe("command adapters", () => {
  const NOW_ISO = NOW.toISOString();

  function church(): ChurchSnapshot {
    return snapshot({
      people: [visitor(), member()],
      households: [{ id: "h1", name: "Adeyemi household", createdAt: NOW_ISO }],
      tasks: [task()],
      sessions: [session(), session({ id: "session_mid", name: "Midweek service", date: "2026-10-08" })],
      attendance: [attendance({ personId: "person_member", firstVisit: false })],
      groups: [group({ members: [{ personId: "person_member", joinedAt: NOW_ISO, addedBy: TEAM_IDS.admin, role: "member" }] })],
      templates: [
        {
          id: "tpl_custom",
          name: "Custom",
          category: "general_check_in",
          channels: ["sms"],
          body: "Hi {{firstName}}",
          createdAt: NOW_ISO,
          updatedAt: NOW_ISO,
          builtIn: false,
        },
      ],
      careRecords: [
        {
          id: "care_1",
          reference: "CARE-0001",
          personId: "person_member",
          category: "hospital_visit",
          summary: "Hospital visit",
          receivedAt: "2026-10-10",
          status: "new",
          notes: [],
          appointments: [{ id: "appt_1", date: "2026-10-14", time: "10:00", status: "scheduled" }],
          createdAt: NOW_ISO,
          updatedAt: NOW_ISO,
        },
      ],
    });
  }

  function run(name: CommandName, body: unknown) {
    const command = commandFor(name);
    return unwrap(command.run(church(), command.schema.parse(body), ctx()));
  }

  const visitorOf = (data: ChurchSnapshot) => data.people.find((person) => person.id === "person_visitor");
  const memberOf = (data: ChurchSnapshot) => data.people.find((person) => person.id === "person_member");

  it.each<[CommandName, unknown, (data: ChurchSnapshot) => unknown, unknown]>([
    [
      "visitor.recordReturnVisit",
      { personId: "person_visitor", sessionId: "session_mid" },
      (data) => data.attendance.filter((row) => row.personId === "person_visitor").map((row) => row.sessionId),
      ["session_mid"],
    ],
    ["visitor.assign", { personId: "person_visitor", assigneeId: TEAM_IDS.coordinator }, (data) => visitorOf(data)?.visitor?.assignedTo, TEAM_IDS.coordinator],
    ["visitor.setStage", { personId: "person_visitor", stageId: "contacted" }, (data) => visitorOf(data)?.visitor?.stageId, "contacted"],
    ["visitor.recordMembershipInterest", { personId: "person_visitor" }, (data) => visitorOf(data)?.visitor?.membershipInterestAt, NOW_ISO],
    [
      "task.reschedule",
      { taskId: "task_fixture", dueDate: "2026-10-20", reason: "Away" },
      (data) => [data.tasks[0].dueDate, data.tasks[0].rescheduleHistory[0].reason],
      ["2026-10-20", "Away"],
    ],
    ["task.assign", { taskId: "task_fixture", assigneeId: TEAM_IDS.coordinator }, (data) => data.tasks[0].assigneeId, TEAM_IDS.coordinator],
    ["task.start", { taskId: "task_fixture" }, (data) => data.tasks[0].status, "in_progress"],
    [
      "task.cancel",
      { taskId: "task_fixture", reason: "Moved away" },
      (data) => [data.tasks[0].status, data.tasks[0].notes],
      ["cancelled", "Cancelled: Moved away"],
    ],
    [
      "task.createForPeople",
      { personIds: ["person_visitor", "person_member"], input: { type: "check_in", priority: "high" } },
      (data) => data.tasks.slice(1).map((entry) => [entry.personId, entry.type, entry.priority]),
      [
        ["person_visitor", "check_in", "high"],
        ["person_member", "check_in", "high"],
      ],
    ],
    [
      "member.changeStatus",
      { personId: "person_member", status: "inactive", reason: "Moved away" },
      (data) => [memberOf(data)?.member?.status, memberOf(data)?.member?.statusHistory.at(-1)?.reason],
      ["inactive", "Moved away"],
    ],
    ["member.recordOrientationCompleted", { personId: "person_visitor" }, (data) => data.activity[0].type, "membership.orientation_completed"],
    [
      "member.setEmergencyContact",
      { personId: "person_member", contact: { name: "Femi", relationship: "Brother", phone: "07700 900999" } },
      (data) => memberOf(data)?.member?.emergencyContact,
      { name: "Femi", relationship: "Brother", phone: "07700 900999" },
    ],
    ["member.setRequestedContact", { personId: "person_member", requested: true }, (data) => memberOf(data)?.member?.requestedContact, true],
    ["person.correct", { personId: "person_visitor", changes: { lastName: "Bello" } }, (data) => visitorOf(data)?.lastName, "Bello"],
    ["person.delete", { personId: "person_visitor", reason: "Request" }, (data) => data.people.map((person) => person.id), ["person_member"]],
    ["person.setHousehold", { personId: "person_visitor", householdId: "h1" }, (data) => visitorOf(data)?.householdId, "h1"],
    ["person.setHousehold", { personId: "person_visitor", householdId: null }, (data) => visitorOf(data)?.householdId, undefined],
    ["session.updateNotes", { sessionId: "session_mid", notes: "Harvest" }, (data) => data.sessions[1].notes, "Harvest"],
    ["attendance.remove", { recordId: "attendance_fixture", reason: "Mistake" }, (data) => data.attendance[0].status, "removed"],
    ["attendance.move", { recordId: "attendance_fixture", toSessionId: "session_mid" }, (data) => data.attendance[0].sessionId, "session_mid"],
    [
      "attendance.importCsv",
      { sessionId: "session_mid", csv: "name\nTunde Balogun" },
      (data) => data.attendance.map((row) => [row.personId, row.sessionId, row.method]),
      [
        ["person_member", "session_sunday", "search"],
        ["person_visitor", "session_mid", "csv_import"],
      ],
    ],
    [
      "group.addMember",
      { groupId: "group_connect", personId: "person_visitor" },
      (data) => data.groups[0].members.map((entry) => [entry.personId, entry.role]),
      [
        ["person_member", "member"],
        ["person_visitor", "member"],
      ],
    ],
    ["group.removeMember", { groupId: "group_connect", personId: "person_member" }, (data) => data.groups[0].members, []],
    ["group.setLeader", { groupId: "group_connect", personId: "person_member" }, (data) => data.groups[0].leaderId, "person_member"],
    ["group.setActive", { groupId: "group_connect", active: false }, (data) => data.groups[0].active, false],
    [
      "template.update",
      { templateId: "tpl_custom", input: { name: "Renamed", category: "thank_you", channels: ["email"], body: "Thanks {{firstName}}" } },
      (data) => [data.templates[0].name, data.templates[0].channels],
      ["Renamed", ["email"]],
    ],
    ["template.delete", { templateId: "tpl_custom" }, (data) => data.templates, []],
    ["care.update", { recordId: "care_1", changes: { status: "in_progress" } }, (data) => data.careRecords[0].status, "in_progress"],
    ["care.addNote", { recordId: "care_1", text: "Visited today" }, (data) => data.careRecords[0].notes.map((note) => note.text), ["Visited today"]],
    [
      "care.scheduleAppointment",
      { recordId: "care_1", input: { date: "2026-10-20", time: "14:00", location: "Church office" } },
      (data) => data.careRecords[0].appointments.map((entry) => entry.date),
      ["2026-10-14", "2026-10-20"],
    ],
    [
      "care.setAppointmentStatus",
      { recordId: "care_1", appointmentId: "appt_1", status: "completed" },
      (data) => data.careRecords[0].appointments[0].status,
      "completed",
    ],
    ["settings.updateProfile", { churchName: "Riverside Chapel" }, (data) => data.settings.churchName, "Riverside Chapel"],
    [
      "settings.updateAutomationRule",
      { id: "overdue_alert", changes: { enabled: false } },
      (data) => data.settings.automationRules.find((rule) => rule.id === "overdue_alert")?.enabled,
      false,
    ],
    ["settings.updateEngagement", { maxContactAttempts: 5 }, (data) => data.settings.engagement.maxContactAttempts, 5],
    [
      "settings.updatePipelineStages",
      { stages: snapshot().settings.pipelineStages.map((stage) => ({ ...stage, order: 10 - stage.order })) },
      (data) => data.settings.pipelineStages.map((stage) => stage.order),
      [1, 2, 3, 4, 5, 6, 7, 8, 9],
    ],
    [
      "settings.updateServices",
      { services: snapshot().settings.services.slice(0, 1) },
      (data) => data.settings.services.map((service) => service.id),
      ["svc_sunday_main"],
    ],
    [
      "settings.setTeamMemberActive",
      { teamMemberId: TEAM_IDS.volunteerAmara, active: false },
      (data) => data.team.find((entry) => entry.id === TEAM_IDS.volunteerAmara)?.active,
      false,
    ],
  ])("%s passes its input through", (name, body, read, expected) => {
    expect(read(run(name, body).snapshot)).toEqual(expected);
  });

  it("propagates a refusal from the domain function unchanged", () => {
    const command = commandFor("task.start");
    const outcome = command.run(church(), command.schema.parse({ taskId: "missing" }), ctx());
    expect(outcome).toMatchObject({ ok: false, code: "not_found" });
  });

  describe("visitor.bulkAssign", () => {
    it("assigns everyone it can and skips refusals without aborting", () => {
      const outcome = run("visitor.bulkAssign", {
        personIds: ["person_visitor", "person_member", "ghost"],
        assigneeId: TEAM_IDS.volunteerAmara,
      });
      expect(visitorOf(outcome.snapshot)?.visitor?.assignedTo).toBe(TEAM_IDS.volunteerAmara);
      // Skipped people are named, not silently counted as done.
      expect(outcome.notices).toEqual([
        "1 visitor assigned.",
        "Skipped 2: Grace Adeyemi (not a visitor), someone no longer listed.",
      ]);
      expect(outcome.events).toEqual([]);
    });

    it("pluralises and reports zero when nobody could be assigned", () => {
      const twoVisitors = church();
      const data = { ...twoVisitors, people: [...twoVisitors.people, visitor({ id: "v2" })] };
      const command = commandFor("visitor.bulkAssign");
      const both = unwrap(
        command.run(data, command.schema.parse({ personIds: ["person_visitor", "v2"], assigneeId: TEAM_IDS.coordinator }), ctx()),
      );
      expect(both.notices).toEqual(["2 visitors assigned."]);

      const none = run("visitor.bulkAssign", { personIds: ["person_visitor"], assigneeId: TEAM_IDS.volunteerEsther });
      expect(none.notices).toEqual(["0 visitors assigned.", "Skipped 1: Tunde Balogun (that helper is inactive)."]);
    });

    it("skips people who opted out, whose follow-up stopped, or who are already theirs", () => {
      const base = church();
      const data = {
        ...base,
        people: [
          ...base.people,
          visitor({ id: "v_out", firstName: "Reuben", contact: { preferredMethod: "sms", permissionGranted: false, optedOut: true } }),
          visitor({ id: "v_closed", firstName: "Folake", visitor: { ...visitor().visitor!, closure: { reason: "paused", recordedAt: "2026-10-01T09:00:00.000Z" } } }),
          visitor({ id: "v_mine", firstName: "Victor", visitor: { ...visitor().visitor!, assignedTo: TEAM_IDS.coordinator } }),
        ],
      };
      const command = commandFor("visitor.bulkAssign");
      const outcome = unwrap(
        command.run(data, command.schema.parse({ personIds: ["v_out", "v_closed", "v_mine"], assigneeId: TEAM_IDS.coordinator }), ctx()),
      );
      expect(outcome.notices).toEqual([
        "0 visitors assigned.",
        "Skipped 3: Reuben Balogun (asked not to be contacted), Folake Balogun (follow-up stopped), Victor Balogun (already theirs).",
      ]);
      expect(outcome.snapshot.activity).toEqual(data.activity);
    });
  });

  describe("dates and times", () => {
    const schema = commandFor("task.reschedule").schema;
    it("refuses a day that is not on the calendar", () => {
      for (const dueDate of ["2026-02-31", "2026-13-01", "2026-00-10", "26-01-01"]) {
        expect(schema.safeParse({ taskId: "t", dueDate }).success, dueDate).toBe(false);
      }
      expect(schema.safeParse({ taskId: "t", dueDate: "2028-02-29" }).success).toBe(true);
    });

    it("refuses a time that is not on the clock", () => {
      const session = commandFor("session.create").schema;
      const base = { name: "Prayer", date: "2026-11-01", type: "prayer_meeting" };
      expect(session.safeParse({ ...base, startTime: "25:99" }).success).toBe(false);
      expect(session.safeParse({ ...base, startTime: "23:59" }).success).toBe(true);
    });
  });
});
