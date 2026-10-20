import type { Capability, DemoRole } from "@/types/team";

/**
 * The capability map.
 *
 * One table, used by both sides: the interface reads it to decide what to
 * offer, the server reads it to decide what to allow. A capability added to
 * a role is added once, and the two can never disagree.
 */
const ROLE_CAPABILITIES: Record<DemoRole, readonly Capability[]> = {
  administrator: [
    "people.read",
    "people.write",
    "visitors.write",
    "tasks.read.all",
    "tasks.read.own",
    "tasks.write",
    "tasks.assign",
    "attendance.write",
    "groups.write",
    "communications.write",
    "analytics.read",
    "settings.write",
    "exports.run",
    "sessions.manage",
    "templates.manage",
  ],
  pastor: [
    "people.read",
    "people.write",
    "tasks.read.all",
    "tasks.read.own",
    "tasks.write",
    "attendance.write",
    "groups.write",
    "care.read",
    "care.write",
    "communications.write",
    "analytics.read",
    "sessions.manage",
    "templates.manage",
  ],
  follow_up_coordinator: [
    "people.read",
    "people.write",
    "visitors.write",
    "tasks.read.all",
    "tasks.read.own",
    "tasks.write",
    "tasks.assign",
    "attendance.write",
    "communications.write",
    "analytics.read",
    "exports.run",
    "sessions.manage",
    "templates.manage",
  ],
  volunteer: [
    "people.read",
    "visitors.write",
    "tasks.read.own",
    "tasks.write",
    "attendance.write",
    "communications.write",
  ],
  member: [],
};

export function capabilitiesFor(role: DemoRole): readonly Capability[] {
  return ROLE_CAPABILITIES[role];
}

export function can(role: DemoRole, capability: Capability): boolean {
  return ROLE_CAPABILITIES[role].includes(capability);
}

export function canAny(role: DemoRole, capabilities: readonly Capability[]): boolean {
  return capabilities.some((capability) => can(role, capability));
}

/** Roles allowed to open the restricted pastoral-care section. */
export function canViewCare(role: DemoRole): boolean {
  return can(role, "care.read");
}

/**
 * Whether the role sees every task or only its own. Volunteers intentionally
 * see a narrower pipeline: their own work, not the church's.
 */
export function taskScope(role: DemoRole): "all" | "own" | "none" {
  if (can(role, "tasks.read.all")) return "all";
  if (can(role, "tasks.read.own")) return "own";
  return "none";
}
