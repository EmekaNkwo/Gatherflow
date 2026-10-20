"use client";

import { useCallback, useMemo } from "react";
import type { PipelineStage } from "@/types/follow-up";
import type { AutomationRuleChanges, ProfileChanges } from "@/services/settings/settings";
import type {
  AutomationRuleId,
  EngagementCriteria,
  ServiceDefinition,
} from "@/types/settings";
import type { DemoRole } from "@/types/team";
import { useChurchStore } from "@/stores/church-store";
import { useCommand, useSnapshot } from "./use-church-data";

/** Church configuration, the automation rules and the team. */
export function useChurchSettings() {
  const snapshot = useSnapshot();
  const { dispatch } = useCommand();
  const report = useChurchStore((state) => state.report);

  const rules = useMemo(() => snapshot.settings.automationRules, [snapshot.settings]);
  const stages = useMemo(
    () => [...snapshot.settings.pipelineStages].sort((left, right) => left.order - right.order),
    [snapshot.settings],
  );

  const saveProfile = useCallback(
    (changes: ProfileChanges) =>
      dispatch("settings.updateProfile", changes),
    [dispatch],
  );

  const saveRule = useCallback(
    (id: AutomationRuleId, changes: AutomationRuleChanges) =>
      dispatch("settings.updateAutomationRule", { id, changes }),
    [dispatch],
  );

  const saveEngagement = useCallback(
    (changes: Partial<EngagementCriteria>) =>
      dispatch("settings.updateEngagement", changes),
    [dispatch],
  );

  const saveStages = useCallback(
    (next: readonly PipelineStage[]) =>
      dispatch("settings.updatePipelineStages", { stages: [...next] }),
    [dispatch],
  );

  const saveServices = useCallback(
    (next: readonly ServiceDefinition[]) =>
      dispatch("settings.updateServices", { services: [...next] }),
    [dispatch],
  );

  const saveTeamMember = useCallback(
    (input: { id?: string; name: string; role: DemoRole; title?: string; active?: boolean }) =>
      dispatch("settings.upsertTeamMember", input),
    [dispatch],
  );

  const setMemberActive = useCallback(
    (teamMemberId: string, active: boolean) =>
      dispatch("settings.setTeamMemberActive", { teamMemberId, active }),
    [dispatch],
  );

  /** Moves every open follow-up from one team member to another. */
  const reassignOpenTasks = useCallback(
    (fromTeamMemberId: string, toTeamMemberId: string) =>
      dispatch("settings.reassignOpenTasks", { fromTeamMemberId, toTeamMemberId }),
    [dispatch],
  );

  return {
    settings: snapshot.settings,
    rules,
    stages,
    services: snapshot.settings.services,
    team: snapshot.team,
    report,
    saveProfile,
    saveRule,
    saveEngagement,
    saveStages,
    saveServices,
    saveTeamMember,
    setMemberActive,
    reassignOpenTasks,
  };
}
