"use client";

import { useCallback, useMemo } from "react";
import { capabilitiesFor } from "@/lib/permissions";
import type { Capability } from "@/types/team";
import { useSessionStore } from "@/stores/session-store";
import { useSnapshot } from "./use-church-data";

/**
 * The signed-in account's role and team member, as the server resolved
 * them, and the capability checks the interface uses to decide what to
 * offer. Advisory only: every one of these is enforced again on the server.
 */
export function useRole() {
  const role = useSessionStore((state) => state.role);
  const teamMemberId = useSessionStore((state) => state.teamMemberId);
  const snapshot = useSnapshot();

  const capabilities = useMemo(() => capabilitiesFor(role), [role]);
  const currentMember = useMemo(
    () => snapshot.team.find((member) => member.id === teamMemberId),
    [snapshot.team, teamMemberId],
  );

  const can = useCallback(
    (capability: Capability) => capabilities.includes(capability),
    [capabilities],
  );

  const canAll = useCallback(
    (required: readonly Capability[]) => required.every((capability) => capabilities.includes(capability)),
    [capabilities],
  );

  const assignableTeam = useMemo(
    () => snapshot.team.filter((member) => member.active && member.role !== "member"),
    [snapshot.team],
  );

  return {
    role,
    teamMemberId,
    currentMember,
    capabilities,
    can,
    canAll,
    assignableTeam,
    team: snapshot.team,
  };
}
