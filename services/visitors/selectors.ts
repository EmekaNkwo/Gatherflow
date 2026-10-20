import { toIsoDate } from "@/lib/dates";
import { plainStageName } from "./stage-names";
import type { CsvColumn } from "@/lib/csv";
import { matchesPersonQuery } from "@/lib/person-search";
import type { ContactMethod, IsoDate, StageId, TeamMemberId } from "@/types/common";
import { CONTACT_METHOD_LABELS } from "@/types/common";
import type { FollowUpTask, PipelineStage } from "@/types/follow-up";
import { CLOSURE_REASON_LABELS, VISITOR_SOURCE_LABELS, type Person } from "@/types/person";
import type { ChurchSnapshot } from "@/types/snapshot";
import { isOpen } from "../follow-ups/tasks";
import { isOverdue } from "../follow-ups/selectors";
import { lastAttendanceDate } from "../analytics/attendance";
import { visitIndex } from "../attendance/visits";
import { isAwaitingAssignment, isTerminalStage } from "./pipeline";
import { visitSummary } from "../attendance/visits";
import type { ChurchSettings } from "@/types/settings";

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
  | "first_time_this_month"
  | "returning"
  | "awaiting_assignment"
  | "awaiting_contact"
  | "contacted"
  | "overdue"
  | "awaiting_second_visit"
  | "awaiting_orientation"
  | "contact_declined"
  | "became_member"
  | "no_next_step";

export const VISITOR_FILTER_LABELS: Record<VisitorFilter, string> = {
  all: "All visitors",
  first_time: "First-time visitors",
  first_time_this_month: "First came this month",
  returning: "Returning visitors",
  awaiting_assignment: "Awaiting assignment",
  awaiting_contact: "Awaiting contact",
  contacted: "Contacted",
  overdue: "Follow-up overdue",
  awaiting_second_visit: "Awaiting a second visit",
  awaiting_orientation: "Awaiting membership orientation",
  contact_declined: "Contact declined",
  became_member: "Became a member",
  no_next_step: "No next step",
};

/** The first day of the month `today` falls in. */
export function monthStartOf(today: IsoDate): IsoDate {
  return `${today.slice(0, 7)}-01`;
}

/**
 * Somebody whose first visit was this calendar month. The first visit is
 * the earliest one we know of (attendance or the registered visit), and
 * anyone registered as having been before is not a first-timer. The one
 * definition behind the dashboard tile, the list it opens and the journey
 * report, so they always agree.
 */
export function firstVisitedThisMonth(snapshot: ChurchSnapshot, person: Person, today: IsoDate): boolean {
  if (!person.visitor || person.visitor.returningVisitor) return false;
  const first = visitSummary(snapshot, person.id, { until: today }).firstVisitDate;
  return Boolean(first) && first! >= monthStartOf(today) && first! <= today;
}

/**
 * A visitor still being followed up who has nothing planned: no open task,
 * not stopped, not settled, and somebody is already looking after them (the
 * unassigned are counted separately). Without this check a visitor can fall
 * out of every worklist after an outcome that creates no next step.
 */
export function hasNoNextStep(
  settings: ChurchSettings,
  person: Person,
  openTaskCount: number,
): boolean {
  const visitor = person.visitor;
  return (
    visitor !== undefined &&
    !person.member &&
    !visitor.closure &&
    !person.contact.optedOut &&
    !isTerminalStage(settings, visitor.stageId) &&
    !isAwaitingAssignment(settings, person) &&
    openTaskCount === 0
  );
}

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
  // Visits as check-in counts them (services/attendance/visits.ts): the
  // registered visit and "they've been before" included, up to today.
  const visitsOf = visitIndex(snapshot, { until: today });

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
        firstVisit: visitsOf(person).firstVisitDate ?? visitor.firstVisitDate,
        lastVisit: lastAttendanceDate(snapshot, person.id),
        visits: visitsOf(person).count,
        stage,
        statusLabel: person.member
          ? "Became a member"
          : visitor.closure
            ? CLOSURE_REASON_LABELS[visitor.closure.reason]
            : stage
              ? plainStageName(stage)
              : "Unknown stage",
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
  const search = query.search?.trim() ?? "";
  const filter = query.filter ?? "all";
  const today = toIsoDate(now);

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

    if (search && !matchesPersonQuery(row.person, search)) return false;

    return matchesFilter(row, filter, snapshot, today);
  });
}

function matchesFilter(
  row: VisitorRow,
  filter: VisitorFilter,
  snapshot: ChurchSnapshot,
  today: IsoDate,
): boolean {
  const visitor = row.person.visitor;
  if (!visitor) return false;

  switch (filter) {
    case "all":
      return true;
    case "first_time":
      return row.visits <= 1 && !row.person.member;
    case "first_time_this_month":
      return firstVisitedThisMonth(snapshot, row.person, today);
    case "returning":
      return row.visits > 1 && !row.person.member;
    case "awaiting_assignment":
      return isAwaitingAssignment(snapshot.settings, row.person);
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
    case "no_next_step":
      return hasNoNextStep(snapshot.settings, row.person, row.openTaskCount);
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
