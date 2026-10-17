"use client";

import { useMemo } from "react";
import type { PersonId } from "@/types/common";
import type { ActivityEvent } from "@/types/activity";
import { journeyFor, latestMilestone } from "@/services/analytics/journey";
import { useSessionStore } from "@/stores/session-store";
import { canViewCare } from "@/lib/permissions";
import { useSnapshot } from "./use-church-data";

/**
 * One person's journey and timeline.
 *
 * The timeline is filtered by the signed-in role: restricted entries
 * (pastoral care) are only included for roles authorised to see them.
 */
export function useMemberJourney(personId: PersonId) {
  const snapshot = useSnapshot();
  const role = useSessionStore((state) => state.role);
  const includeRestricted = canViewCare(role);

  return useMemo(() => {
    const milestones = journeyFor(snapshot, personId);
    const timeline: ActivityEvent[] = snapshot.activity.filter(
      (event) =>
        event.personId === personId &&
        (includeRestricted || event.visibility === "general"),
    );

    return {
      milestones,
      reached: milestones.filter((milestone) => milestone.at),
      next: milestones.find((milestone) => !milestone.at && !milestone.optional),
      latest: latestMilestone(snapshot, personId),
      timeline,
      restrictedHidden: !includeRestricted,
    };
  }, [snapshot, personId, includeRestricted]);
}
