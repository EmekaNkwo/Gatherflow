import { isWithinRange, toIsoDate } from "@/lib/dates";
import { ratio } from "@/lib/metrics";
import type { DateRange, PersonId, Ratio } from "@/types/common";
import {
  JOURNEY_MILESTONE_LABELS,
  type JourneyMilestone,
  type JourneyMilestoneKey,
} from "@/types/activity";
import type { ChurchSnapshot } from "@/types/snapshot";
import { personAttendance } from "./attendance";
import { visitIndex, visitSummary } from "../attendance/visits";

/**
 * The visitor-to-member journey.
 *
 * Milestones are recorded as dated facts, not as a completion percentage,
 * and later milestones never require earlier ones: someone can join a group
 * without ever having had a follow-up call. A journey is a description of
 * what happened — never a measure of anyone's faith or commitment.
 */

const OPTIONAL_MILESTONES: readonly JourneyMilestoneKey[] = [
  "follow_up_completed",
  "membership_interest",
  "orientation_completed",
  "group_joined",
  "ministry_involvement",
];

export function journeyFor(snapshot: ChurchSnapshot, personId: PersonId): JourneyMilestone[] {
  const person = snapshot.people.find((entry) => entry.id === personId);
  if (!person) return [];

  const attended = personAttendance(snapshot, personId)
    .filter((entry) => entry.record.status === "present" && entry.session)
    .sort((left, right) => ((left.session?.date ?? "") < (right.session?.date ?? "") ? -1 : 1));
  // Every dated visit, the registered one included, oldest first.
  const visitDates = visitSummary(snapshot, personId).dates;
  const sessionOn = (date: string | undefined) =>
    date ? attended.find((entry) => entry.session?.date === date)?.session : undefined;
  // Somebody who told us they had been before is on at least their second
  // visit the first time we see them.
  const secondVisitDate = person.visitor?.returningVisitor ? visitDates[0] : visitDates[1];

  const completedFollowUp = snapshot.tasks
    .filter(
      (task) =>
        task.personId === personId && task.status === "completed" && task.outcome === "contacted",
    )
    .sort((left, right) => ((left.completedAt ?? "") < (right.completedAt ?? "") ? -1 : 1))[0];

  const orientation = snapshot.activity.find(
    (event) => event.personId === personId && event.type === "membership.orientation_completed",
  );

  const groupJoin = snapshot.groups
    .flatMap((group) =>
      group.members
        .filter((member) => member.personId === personId)
        .map((member) => ({ group, joinedAt: member.joinedAt, role: member.role })),
    )
    .sort((left, right) => (left.joinedAt < right.joinedAt ? -1 : 1));

  const ministry = groupJoin.find(
    (entry) => entry.group.type !== "connect_group" || entry.role === "leader",
  );

  const firstMembership = person.member?.statusHistory[0];

  const milestones: Array<{ key: JourneyMilestoneKey; at?: string; detail?: string }> = [
    {
      key: "first_visit",
      at: visitDates[0] ? `${visitDates[0]}T12:00:00.000Z` : undefined,
      detail: person.visitor?.returningVisitor
        ? "First recorded visit (they had been before)"
        : visitDates[0] === person.visitor?.firstVisitDate
          ? "Registered as a visitor"
          : "First recorded attendance",
    },
    {
      key: "follow_up_completed",
      at: completedFollowUp?.completedAt,
      detail: completedFollowUp ? `${completedFollowUp.reference} — successfully contacted` : undefined,
    },
    {
      key: "second_visit",
      at: secondVisitDate ? `${secondVisitDate}T12:00:00.000Z` : undefined,
      detail: sessionOn(secondVisitDate)?.name,
    },
    {
      key: "membership_interest",
      at: person.visitor?.membershipInterestAt,
      detail: "Asked about becoming a member",
    },
    {
      key: "orientation_completed",
      at: orientation?.at,
      detail: "Attended membership orientation",
    },
    {
      key: "membership_confirmed",
      at: firstMembership?.changedAt,
      detail: person.member ? `Member ${person.member.reference}` : undefined,
    },
    {
      key: "group_joined",
      at: groupJoin[0]?.joinedAt,
      detail: groupJoin[0]?.group.name,
    },
    {
      key: "ministry_involvement",
      at: ministry?.joinedAt,
      detail: ministry?.group.name,
    },
  ];

  return milestones.map((milestone) => ({
    key: milestone.key,
    label: JOURNEY_MILESTONE_LABELS[milestone.key],
    at: milestone.at,
    optional: OPTIONAL_MILESTONES.includes(milestone.key),
    detail: milestone.at ? milestone.detail : undefined,
  }));
}

export interface JourneyReport {
  range: DateRange;
  /** Everyone whose first visit falls inside the range. */
  cohortSize: number;
  firstTimeVisitors: number;
  contacted: Ratio;
  returned: Ratio;
  requestedOrientation: Ratio;
  becameMembers: Ratio;
  joinedGroup: Ratio;
  /** Visitors whose record is closed, with the reason, for transparency. */
  closed: number;
}

/**
 * Conversion report for a cohort of visitors.
 *
 * Every rate uses the same, stated denominator: the number of first-time
 * visitors whose first visit falls inside the range.
 */
export function journeyReport(
  snapshot: ChurchSnapshot,
  range: DateRange,
): JourneyReport {
  // First-time visitors by their earliest known visit, counted with the same
  // definition of a visit as check-in (services/attendance/visits.ts).
  const visitsOf = visitIndex(snapshot);
  const cohort = snapshot.people.filter((person) => {
    if (!person.visitor || person.visitor.returningVisitor) return false;
    const first = visitsOf(person).firstVisitDate;
    return first !== undefined && isWithinRange(first, range);
  });

  const denominator = cohort.length;
  const contacted = cohort.filter((person) =>
    snapshot.tasks.some(
      (task) =>
        task.personId === person.id &&
        task.status === "completed" &&
        task.outcome === "contacted",
    ),
  ).length;

  const returned = cohort.filter((person) => visitsOf(person).count > 1).length;
  const requestedOrientation = cohort.filter(
    (person) => person.visitor?.membershipInterestAt,
  ).length;
  const becameMembers = cohort.filter((person) => Boolean(person.member)).length;
  const joinedGroup = cohort.filter((person) => person.groupIds.length > 0).length;

  return {
    range,
    cohortSize: denominator,
    firstTimeVisitors: denominator,
    contacted: ratio(contacted, denominator),
    returned: ratio(returned, denominator),
    requestedOrientation: ratio(requestedOrientation, denominator),
    becameMembers: ratio(becameMembers, denominator),
    joinedGroup: ratio(joinedGroup, denominator),
    closed: cohort.filter((person) => person.visitor?.closure).length,
  };
}

/** The most recent milestone reached, for the pipeline card subtitle. */
export function latestMilestone(
  snapshot: ChurchSnapshot,
  personId: PersonId,
): JourneyMilestone | undefined {
  return journeyFor(snapshot, personId)
    .filter((milestone) => milestone.at)
    .sort((left, right) => ((left.at ?? "") < (right.at ?? "") ? 1 : -1))[0];
}

/** Default report range: the last 90 days. */
export function defaultJourneyRange(now: Date): DateRange {
  const to = toIsoDate(now);
  const from = toIsoDate(new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000));
  return { from, to };
}
