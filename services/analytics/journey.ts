import { isWithinRange, toIsoDate } from "@/lib/dates";
import { ratio } from "@/lib/metrics";
import type { DateRange, PersonId, Ratio } from "@/types/common";
import {
  JOURNEY_MILESTONE_LABELS,
  type JourneyMilestone,
  type JourneyMilestoneKey,
} from "@/types/activity";
import type { Person } from "@/types/person";
import type { ChurchSnapshot } from "@/types/snapshot";
import { personAttendance } from "./attendance";

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

  const visits = personAttendance(snapshot, personId).filter(
    (entry) => entry.record.status === "present",
  );
  const sortedVisits = [...visits].sort((left, right) =>
    (left.session?.date ?? "") < (right.session?.date ?? "") ? -1 : 1,
  );

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
      at: person.visitor
        ? `${person.visitor.firstVisitDate}T12:00:00.000Z`
        : sortedVisits[0]?.session
          ? `${sortedVisits[0].session.date}T12:00:00.000Z`
          : undefined,
      detail: person.visitor ? "Registered as a visitor" : "First recorded attendance",
    },
    {
      key: "follow_up_completed",
      at: completedFollowUp?.completedAt,
      detail: completedFollowUp ? `${completedFollowUp.reference} — successfully contacted` : undefined,
    },
    {
      key: "second_visit",
      at: sortedVisits[1]?.session ? `${sortedVisits[1].session.date}T12:00:00.000Z` : undefined,
      detail: sortedVisits[1]?.session?.name,
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
  const cohort = snapshot.people.filter(
    (person) => person.visitor && isWithinRange(person.visitor.firstVisitDate, range),
  );

  const denominator = cohort.length;
  const contacted = cohort.filter((person) =>
    snapshot.tasks.some(
      (task) =>
        task.personId === person.id &&
        task.status === "completed" &&
        task.outcome === "contacted",
    ),
  ).length;

  const returned = cohort.filter((person) => countVisits(snapshot, person) > 1).length;
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

function countVisits(snapshot: ChurchSnapshot, person: Person): number {
  return snapshot.attendance.filter(
    (row) => row.personId === person.id && row.status === "present",
  ).length;
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
