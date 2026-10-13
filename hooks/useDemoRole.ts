"use client";

import { useCallback, useMemo } from "react";
import { capabilitiesFor } from "@/lib/permissions";
import type { Capability, DemoRole } from "@/types/team";
import { useSessionStore } from "@/stores/session-store";
import { useSnapshot } from "./use-church-data";

/**
 * The active demo role.
 *
 * Role switching changes which interface a reviewer sees. It is not access
 * control: the check runs in the browser and is documented as a
 * demonstration only.
 */
export function useDemoRole() {
  const role = useSessionStore((state) => state.role);
  const teamMemberId = useSessionStore((state) => state.teamMemberId);
  const switchRole = useSessionStore((state) => state.switchRole);
  const setTeamMember = useSessionStore((state) => state.setTeamMember);
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

  const switchTo = useCallback(
    (next: DemoRole) => switchRole(next),
    [switchRole],
  );

  const actAs = useCallback(
    (nextTeamMemberId: string) => {
      const member = snapshot.team.find((entry) => entry.id === nextTeamMemberId);
      if (member) setTeamMember(member.id, member.role);
    },
    [snapshot.team, setTeamMember],
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
    switchTo,
    actAs,
  };
}
