"use client";

import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import { downloadJson } from "@/lib/csv";
import type { PipelineStage } from "@/types/follow-up";
import type {
  AutomationRuleConfig,
  AutomationRuleId,
  EngagementCriteria,
  ServiceDefinition,
} from "@/types/settings";
import type { DemoRole } from "@/types/team";
import { useChurchStore } from "@/stores/church-store";
import { useCommand, useSnapshot } from "./use-church-data";

/** Church configuration, the automation rules and the demo data controls. */
export function useChurchSettings() {
  const snapshot = useSnapshot();
  const { dispatch } = useCommand();
  const reset = useChurchStore((state) => state.reset);
  const exportBundle = useChurchStore((state) => state.exportBundle);
  const importBundle = useChurchStore((state) => state.importBundle);
  const report = useChurchStore((state) => state.report);
  const seeded = useChurchStore((state) => state.seeded);

  const rules = useMemo(() => snapshot.settings.automationRules, [snapshot.settings]);
  const stages = useMemo(
    () => [...snapshot.settings.pipelineStages].sort((left, right) => left.order - right.order),
    [snapshot.settings],
  );

  const saveProfile = useCallback(
    (changes: { churchName?: string; timezoneLabel?: string; defaultFollowUpDueInDays?: number }) =>
      dispatch("settings.updateProfile", changes),
    [dispatch],
  );

  const saveRule = useCallback(
    (id: AutomationRuleId, changes: Partial<Omit<AutomationRuleConfig, "id">>) =>
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

  const downloadBundle = useCallback(() => {
    const bundle = exportBundle();
    if (!bundle) {
      toast.error("There is nothing to export yet.");
      return;
    }
    downloadJson(`gatherflow-demo-data-${bundle.exportedAt.slice(0, 10)}.json`, bundle);
    toast.success("Demo data exported.", {
      description: "Pastoral-care records and emergency contacts were excluded.",
    });
  }, [exportBundle]);

  const uploadBundle = useCallback(
    async (file: File) => {
      try {
        const parsed = JSON.parse(await file.text()) as unknown;
        const outcome = importBundle(parsed);
        if (outcome.ok) toast.success(outcome.value);
        else toast.error(outcome.error);
      } catch {
        toast.error("That file could not be read as JSON.");
      }
    },
    [importBundle],
  );

  const resetDemoData = useCallback(() => {
    reset();
    toast.success("Demo data restored to the original seed.");
  }, [reset]);

  return {
    settings: snapshot.settings,
    rules,
    stages,
    services: snapshot.settings.services,
    team: snapshot.team,
    report,
    seeded,
    saveProfile,
    saveRule,
    saveEngagement,
    saveStages,
    saveServices,
    saveTeamMember,
    setMemberActive,
    downloadBundle,
    uploadBundle,
    resetDemoData,
  };
}
