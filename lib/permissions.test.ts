import { describe, expect, it } from "vitest";
import { DEMO_ROLES, type Capability, type DemoRole } from "@/types/team";
import { can, canAny, canViewCare, capabilitiesFor, taskScope } from "./permissions";

/**
 * The capability map is shared by the interface and the server, so these
 * tests pin the decisions that matter rather than the table's shape: who may
 * not see pastoral care, who sees only their own work, and that a member can
 * do nothing at all.
 */
describe("the capability map", () => {
  it("gives administrators configuration but not pastoral care", () => {
    expect(can("administrator", "settings.write")).toBe(true);
    expect(can("administrator", "exports.run")).toBe(true);
    // Deliberate, and the rule most likely to be "fixed" by mistake.
    expect(can("administrator", "care.read")).toBe(false);
    expect(can("administrator", "care.write")).toBe(false);
    expect(canViewCare("administrator")).toBe(false);
  });

  it("gives pastors pastoral care but not configuration or exports", () => {
    expect(canViewCare("pastor")).toBe(true);
    expect(can("pastor", "care.write")).toBe(true);
    expect(can("pastor", "settings.write")).toBe(false);
    expect(can("pastor", "exports.run")).toBe(false);
    expect(can("pastor", "visitors.write")).toBe(false);
  });

  it("gives a member nothing", () => {
    expect(capabilitiesFor("member")).toEqual([]);
    const everything: Capability[] = [
      "people.read",
      "tasks.read.own",
      "communications.write",
      "analytics.read",
    ];
    expect(canAny("member", everything)).toBe(false);
  });

  it("lets volunteers work but not assign, configure or report", () => {
    expect(can("volunteer", "tasks.write")).toBe(true);
    expect(can("volunteer", "communications.write")).toBe(true);
    expect(can("volunteer", "tasks.assign")).toBe(false);
    expect(can("volunteer", "tasks.read.all")).toBe(false);
    expect(can("volunteer", "analytics.read")).toBe(false);
    expect(can("volunteer", "people.write")).toBe(false);
  });

  it("only pastors can read or write pastoral care", () => {
    for (const role of DEMO_ROLES) {
      expect(can(role, "care.read"), role).toBe(role === "pastor");
      expect(can(role, "care.write"), role).toBe(role === "pastor");
    }
  });

  it("scopes tasks by role: all, own, or none", () => {
    const expected: Record<DemoRole, ReturnType<typeof taskScope>> = {
      administrator: "all",
      pastor: "all",
      follow_up_coordinator: "all",
      volunteer: "own",
      member: "none",
    };
    for (const role of DEMO_ROLES) {
      expect(taskScope(role), role).toBe(expected[role]);
    }
  });

  it("answers canAny when any one capability is held, and not otherwise", () => {
    expect(canAny("volunteer", ["settings.write", "tasks.write"])).toBe(true);
    expect(canAny("volunteer", ["settings.write", "analytics.read"])).toBe(false);
    expect(canAny("administrator", [])).toBe(false);
  });

  it("returns the same list for the same role, so it can be memoised", () => {
    expect(capabilitiesFor("pastor")).toBe(capabilitiesFor("pastor"));
  });
});
