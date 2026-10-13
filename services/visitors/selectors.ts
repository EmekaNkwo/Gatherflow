import { toIsoDate } from "@/lib/dates";
import type { CsvColumn } from "@/lib/csv";
import { normalise } from "@/lib/strings";
import type { ContactMethod, IsoDate, StageId, TeamMemberId } from "@/types/common";
import { CONTACT_METHOD_LABELS } from "@/types/common";
import type { FollowUpTask, PipelineStage } from "@/types/follow-up";
import { CLOSURE_REASON_LABELS, VISITOR_SOURCE_LABELS, type Person } from "@/types/person";
import type { ChurchSnapshot } from "@/types/snapshot";
import { isOpen } from "../follow-ups/tasks";
import { isOverdue } from "../follow-ups/selectors";
import { lastAttendanceDate, presentVisitCount } from "../analytics/attendance";

/** One row of the visitor directory, with everything the table needs. */
export interface VisitorRow {
  person: Person;
  firstVisit: IsoDate;
  lastVisit?: IsoDate;
  visits: number;
  stage?: PipelineStage;
  statusLabel: string;
  assigneeName?: string;
  nextFollowUpDate?: IsoDate;
  nextFollowUp?: FollowUpTask;
  preferredContactLabel: string;
  openTaskCount: number;
  hasOverdue: boolean;
  closedReason?: string;
  optedOut: boolean;
}

export type VisitorFilter =
  | "all"
  | "first_time"
  | "returning"
  | "awaiting_assignment"
  | "awaiting_contact"
  | "contacted"
  | "overdue"
  | "awaiting_second_visit"
  | "awaiting_orientation"
  | "contact_declined"
  | "became_member";

export const VISITOR_FILTER_LABELS: Record<VisitorFilter, string> = {
  all: "All visitors",
  first_time: "First-time visitors",
  returning: "Returning visitors",
  awaiting_assignment: "Awaiting assignment",
  awaiting_contact: "Awaiting contact",
  contacted: "Contacted",
  overdue: "Follow-up overdue",
  awaiting_second_visit: "Awaiting a second visit",
  awaiting_orientation: "Awaiting membership orientation",
  contact_declined: "Contact declined",
  became_member: "Became a member",
};

export interface VisitorQuery {
  filter?: VisitorFilter;
  search?: string;
  assigneeId?: TeamMemberId | "unassigned";
  stageId?: StageId;
  source?: Person["visitor"] extends undefined ? never : string;
}

export function visitorRows(snapshot: ChurchSnapshot, now: Date): VisitorRow[] {
  const today = toIsoDate(now);
  const stages = new Map(snapshot.settings.pipelineStages.map((stage) => [stage.id, stage]));
  const team = new Map(snapshot.team.map((member) => [member.id, member]));

  return snapshot.people
    .filter((person) => person.visitor)
    .map((person) => {
      const visitor = person.visitor!;
      const openTasks = snapshot.tasks.filter(
        (task) => task.personId === person.id && isOpen(task),
      );
      const next = [...openTasks].sort((left, right) =>
        left.dueDate < right.dueDate ? -1 : 1,
      )[0];
      const stage = stages.get(visitor.stageId);

      return {
        person,
        firstVisit: visitor.firstVisitDate,
        lastVisit: lastAttendanceDate(snapshot, person.id),
        visits: presentVisitCount(snapshot, person.id),
        stage,
        statusLabel: person.member
          ? "Became a member"
          : visitor.closure
            ? CLOSURE_REASON_LABELS[visitor.closure.reason]
            : (stage?.name ?? "Unknown stage"),
        assigneeName: visitor.assignedTo ? team.get(visitor.assignedTo)?.name : undefined,
        nextFollowUpDate: next?.dueDate,
        nextFollowUp: next,
        preferredContactLabel: CONTACT_METHOD_LABELS[person.contact.preferredMethod],
        openTaskCount: openTasks.length,
        hasOverdue: openTasks.some((task) => isOverdue(task, today)),
        closedReason: visitor.closure
          ? CLOSURE_REASON_LABELS[visitor.closure.reason]
          : undefined,
        optedOut: person.contact.optedOut,
      };
    })
    .sort((left, right) => (left.firstVisit < right.firstVisit ? 1 : -1));
}

export function selectVisitors(
  snapshot: ChurchSnapshot,
  query: VisitorQuery,
  now: Date,
): VisitorRow[] {
  const search = query.search ? normalise(query.search) : "";
  const filter = query.filter ?? "all";

  return visitorRows(snapshot, now).filter((row) => {
    if (query.stageId && row.person.visitor?.stageId !== query.stageId) return false;

    if (query.assigneeId === "unassigned" && row.person.visitor?.assignedTo) return false;
    if (
      query.assigneeId &&
      query.assigneeId !== "unassigned" &&
      row.person.visitor?.assignedTo !== query.assigneeId
    ) {
      return false;
    }

    if (search) {
      const haystack = normalise(
        [
          row.person.firstName,
          row.person.lastName,
          row.person.preferredName ?? "",
          row.person.phone ?? "",
          row.person.email ?? "",
        ].join(" "),
      );
      if (!haystack.includes(search)) return false;
    }

    return matchesFilter(row, filter);
  });
}

function matchesFilter(row: VisitorRow, filter: VisitorFilter): boolean {
  const visitor = row.person.visitor;
  if (!visitor) return false;

  switch (filter) {
    case "all":
      return true;
    case "first_time":
      return row.visits <= 1 && !row.person.member;
    case "returning":
      return row.visits > 1 && !row.person.member;
    case "awaiting_assignment":
      return !visitor.assignedTo && !visitor.closure && !row.person.member;
    case "awaiting_contact":
      return !visitor.lastContactAt && !visitor.closure && !row.person.member;
    case "contacted":
      return Boolean(visitor.lastContactAt);
    case "overdue":
      return row.hasOverdue;
    case "awaiting_second_visit":
      return row.visits === 1 && Boolean(visitor.lastContactAt) && !row.person.member;
    case "awaiting_orientation":
      return Boolean(visitor.membershipInterestAt) && !row.person.member;
    case "contact_declined":
      return row.person.contact.optedOut || visitor.closure?.reason === "contact_declined";
    case "became_member":
      return Boolean(row.person.member);
    default:
      return true;
  }
}

/**
 * Export columns.
 *
 * Deliberately excludes visitor notes, pastoral information and emergency
 * contacts: private notes do not belong in an ordinary export.
 */
export const VISITOR_EXPORT_COLUMNS: ReadonlyArray<CsvColumn<VisitorRow>> = [
  { header: "First name", value: (row) => row.person.firstName },
  { header: "Last name", value: (row) => row.person.lastName },
  { header: "Preferred name", value: (row) => row.person.preferredName },
  { header: "Phone", value: (row) => row.person.phone },
  { header: "Email", value: (row) => row.person.email },
  { header: "First visit", value: (row) => row.firstVisit },
  { header: "Last visit", value: (row) => row.lastVisit },
  { header: "Visits", value: (row) => row.visits },
  { header: "Source", value: (row) => VISITOR_SOURCE_LABELS[row.person.visitor!.source] },
  { header: "Follow-up status", value: (row) => row.statusLabel },
  { header: "Assigned to", value: (row) => row.assigneeName },
  { header: "Next follow-up", value: (row) => row.nextFollowUpDate },
  { header: "Preferred contact", value: (row) => row.preferredContactLabel },
  { header: "Contact permission", value: (row) => (row.person.contact.permissionGranted ? "Yes" : "No") },
  { header: "Opted out", value: (row) => (row.optedOut ? "Yes" : "No") },
];

/** Visitors grouped by pipeline stage, for the kanban board. */
export function visitorsByStage(
  snapshot: ChurchSnapshot,
  now: Date,
  query: VisitorQuery = {},
): Array<{ stage: PipelineStage; rows: VisitorRow[] }> {
  const rows = selectVisitors(snapshot, { ...query, stageId: undefined }, now);
  return [...snapshot.settings.pipelineStages]
    .sort((left, right) => left.order - right.order)
    .map((stage) => ({
      stage,
      rows: rows.filter((row) => row.person.visitor?.stageId === stage.id),
    }));
}

export function contactMethodOptions(): Array<{ value: ContactMethod; label: string }> {
  return (Object.keys(CONTACT_METHOD_LABELS) as ContactMethod[]).map((value) => ({
    value,
    label: CONTACT_METHOD_LABELS[value],
  }));
}
