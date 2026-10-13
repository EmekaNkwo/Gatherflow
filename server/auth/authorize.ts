import { can, canViewCare, taskScope } from "@/lib/permissions";
import { err, ok, type Result } from "@/lib/result";
import type { Capability } from "@/types/team";
import {
  type LoadScope,
} from "@/services/repositories/async-snapshot-repository";
import type { ChurchSession } from "./session";

/**
 * Authorisation.
 *
 * This deliberately imports the capability map from `lib/permissions`, the
 * same module the interface uses to decide what to offer. One definition means
 * the button a volunteer cannot see and the request a volunteer cannot make
 * can never disagree — and a capability added to a role is added in one place.
 *
 * The interface's copy remains advisory: it shapes affordances. This copy is
 * the decision.
 */

/** Refusal code for an authenticated caller lacking the capability. */
export const FORBIDDEN = "forbidden";

export function authorize(session: ChurchSession, capability: Capability): Result<true> {
  if (!can(session.role, capability)) {
    return err(
      `Your role does not allow this (${capability.replace(".", " ")}).`,
      FORBIDDEN,
    );
  }
  return ok(true);
}

/**
 * What this session may read, expressed so the repository can turn it into SQL.
 *
 * Fails closed: a role whose tasks are scoped to its own work but which has no
 * linked team member reads no tasks at all, rather than everything.
 */
export function scopeFor(session: ChurchSession): LoadScope {
  const scope = taskScope(session.role);
  return {
    // Administrators are deliberately excluded: configuring the system and
    // reading people's care notes are different jobs.
    careRecords: canViewCare(session.role),
    tasks:
      scope === "all"
        ? "all"
        : scope === "own" && session.teamMemberId
          ? { assigneeId: session.teamMemberId }
          : "none",
  };
}
