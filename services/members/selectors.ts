import type { CsvColumn } from "@/lib/csv";
import { normalise } from "@/lib/strings";
import { ratio } from "@/lib/metrics";
import type { GroupId, IsoDate, Ratio } from "@/types/common";
import { CONTACT_METHOD_LABELS } from "@/types/common";
import { MEMBERSHIP_STATUS_LABELS, type MembershipStatus, type Person } from "@/types/person";
import type { ChurchSnapshot } from "@/types/snapshot";
import {
  lastAttendanceDate,
  recentAttendanceCount,
  weeksSinceLastAttendance,
} from "../analytics/attendance";

export interface MemberRow {
  person: Person;
  reference: string;
  status: MembershipStatus;
  statusLabel: string;
  membershipDate: IsoDate;
  householdName?: string;
  groupNames: string[];
  lastAttendance?: IsoDate;
  weeksSinceAttendance?: number;
  recentWeeks: number;
  openTaskCount: number;
  /** Why this member appears in an engagement report, when they do. */
  reviewReason?: string;
}

export type MemberFilter =
  | "all"
  | "active"
  | "new"
  | "inactive"
  | "transferred"
  | "archived"
  | "requested_contact"
  | "no_group"
  | "needs_review";

export const MEMBER_FILTER_LABELS: Record<MemberFilter, string> = {
  all: "All members",
  active: "Active members",
  new: "New members",
  inactive: "Inactive members",
  transferred: "Transferred",
  archived: "Archived",
  requested_contact: "Requested contact",
  no_group: "Not in a group",
  needs_review: "Flagged for review",
};

export interface MemberQuery {
  filter?: MemberFilter;
  search?: string;
  groupId?: GroupId;
  preferredServiceType?: string;
  membershipFrom?: IsoDate;
  membershipTo?: IsoDate;
}

export function memberRows(snapshot: ChurchSnapshot, now: Date): MemberRow[] {
  const households = new Map(snapshot.households.map((entry) => [entry.id, entry]));
  const groups = new Map(snapshot.groups.map((group) => [group.id, group]));
  const threshold = snapshot.settings.engagement.inactiveAfterWeeksAbsent;
  const window = snapshot.settings.engagement.attendanceAverageWeeks;

  return snapshot.people
    .filter((person) => person.member)
    .map((person) => {
      const member = person.member!;
      const weeksSince = weeksSinceLastAttendance(snapshot, person.id, now);
      const needsReview =
        member.status === "active" && weeksSince !== undefined && weeksSince >= threshold;

      return {
        person,
        reference: member.reference,
        status: member.status,
        statusLabel: MEMBERSHIP_STATUS_LABELS[member.status],
        membershipDate: member.membershipDate,
        householdName: person.householdId ? households.get(person.householdId)?.name : undefined,
        groupNames: person.groupIds
          .map((id) => groups.get(id)?.name)
          .filter((name): name is string => Boolean(name)),
        lastAttendance: lastAttendanceDate(snapshot, person.id),
        weeksSinceAttendance: weeksSince,
        recentWeeks: recentAttendanceCount(snapshot, person.id, now, window),
        openTaskCount: snapshot.tasks.filter(
          (task) =>
            task.personId === person.id &&
            ["pending", "in_progress", "rescheduled"].includes(task.status),
        ).length,
        reviewReason: needsReview
          ? `No attendance recorded for ${weeksSince} weeks (the church's review threshold is ${threshold}).`
          : undefined,
      };
    })
    .sort((left, right) =>
      `${left.person.lastName} ${left.person.firstName}`.localeCompare(
        `${right.person.lastName} ${right.person.firstName}`,
      ),
    );
}

export function selectMembers(
  snapshot: ChurchSnapshot,
  query: MemberQuery,
  now: Date,
): MemberRow[] {
  const search = query.search ? normalise(query.search) : "";
  const filter = query.filter ?? "all";

  return memberRows(snapshot, now).filter((row) => {
    if (query.groupId && !row.person.groupIds.includes(query.groupId)) return false;
    if (
      query.preferredServiceType &&
      row.person.member?.preferredServiceType !== query.preferredServiceType
    ) {
      return false;
    }
    if (query.membershipFrom && row.membershipDate < query.membershipFrom) return false;
    if (query.membershipTo && row.membershipDate > query.membershipTo) return false;

    if (search) {
      const haystack = normalise(
        [
          row.person.firstName,
          row.person.lastName,
          row.person.preferredName ?? "",
          row.reference,
          row.person.phone ?? "",
          row.person.email ?? "",
        ].join(" "),
      );
      if (!haystack.includes(search)) return false;
    }

    switch (filter) {
      case "all":
        return row.status !== "archived";
      case "active":
        return row.status === "active";
      case "new":
        return row.status === "new_member";
      case "inactive":
        return row.status === "inactive";
      case "transferred":
        return row.status === "transferred";
      case "archived":
        return row.status === "archived";
      case "requested_contact":
        return Boolean(row.person.member?.requestedContact);
      case "no_group":
        return row.groupNames.length === 0 && row.status !== "archived";
      case "needs_review":
        return Boolean(row.reviewReason);
      default:
        return true;
    }
  });
}

/** Membership status counts, used by the reports page. */
export function membershipBreakdown(
  snapshot: ChurchSnapshot,
): Array<{ status: MembershipStatus; label: string; count: number }> {
  const statuses: MembershipStatus[] = [
    "active",
    "new_member",
    "inactive",
    "transferred",
    "archived",
  ];
  return statuses.map((status) => ({
    status,
    label: MEMBERSHIP_STATUS_LABELS[status],
    count: snapshot.people.filter((person) => person.member?.status === status).length,
  }));
}

/** Group participation: members in at least one active group. */
export function groupParticipation(snapshot: ChurchSnapshot): Ratio {
  const activeGroups = new Set(
    snapshot.groups.filter((group) => group.active).map((group) => group.id),
  );
  const members = snapshot.people.filter(
    (person) =>
      person.member &&
      !["archived", "transferred"].includes(person.member.status),
  );
  const connected = members.filter((person) =>
    person.groupIds.some((id) => activeGroups.has(id)),
  );
  return ratio(connected.length, members.length);
}

/** Member export columns. Emergency contacts are never exported. */
export const MEMBER_EXPORT_COLUMNS: ReadonlyArray<CsvColumn<MemberRow>> = [
  { header: "Member ID", value: (row) => row.reference },
  { header: "First name", value: (row) => row.person.firstName },
  { header: "Last name", value: (row) => row.person.lastName },
  { header: "Preferred name", value: (row) => row.person.preferredName },
  { header: "Status", value: (row) => row.statusLabel },
  { header: "Membership date", value: (row) => row.membershipDate },
  { header: "Phone", value: (row) => row.person.phone },
  { header: "Email", value: (row) => row.person.email },
  { header: "Household", value: (row) => row.householdName },
  { header: "Groups", value: (row) => row.groupNames.join("; ") },
  { header: "Preferred service", value: (row) => row.person.member?.preferredServiceType },
  {
    header: "Preferred contact",
    value: (row) => CONTACT_METHOD_LABELS[row.person.contact.preferredMethod],
  },
  { header: "Last attendance", value: (row) => row.lastAttendance },
];
