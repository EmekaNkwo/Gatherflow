import { describe, expect, it } from "vitest";
import { can } from "@/lib/permissions";
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
