import type { Capability, DemoRole } from "@/types/team";

/**
 * Simulated role model.
 *
 * These checks shape the demo interface only. They run in the browser, where
 * anyone can change them, and must never be mistaken for access control —
 * production deployments have to enforce this on a server.
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
 * see a narrower pipeline so the demo shows a real difference per role.
 */
export function taskScope(role: DemoRole): "all" | "own" | "none" {
  if (can(role, "tasks.read.all")) return "all";
  if (can(role, "tasks.read.own")) return "own";
  return "none";
}
