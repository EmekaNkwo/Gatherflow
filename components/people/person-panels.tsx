"use client";

import type { ReactNode } from "react";
import { ChevronDownIcon, LockIcon } from "lucide-react";
import { ActivityFeed } from "@/components/dashboard/activity-feed";
import { CHECK_IN_METHOD_LABELS, type AttendanceRecord, type AttendanceSession } from "@/types/attendance";
import { COMMUNICATION_STATUS_LABELS, type CommunicationLogEntry } from "@/types/communication";
import type { ActivityEvent } from "@/types/activity";
import { FOLLOW_UP_TASK_TYPE_LABELS, TASK_OUTCOME_LABELS } from "@/types/follow-up";
import type { TaskWithPerson } from "@/services/follow-ups/selectors";
import { formatDisplayDate, formatDisplayDateTime } from "@/lib/dates";

/**
 * The quieter parts of a person's page: their details and their history.
 * Each is a single card that opens when wanted, so the page leads with what
 * is waiting and who they are.
 */

/** A card that opens on tap. `summary` is said even while it is closed. */
export function Disclosure({
  title,
  summary,
  badge,
  defaultOpen,
  children,
}: {
  title: string;
  summary?: ReactNode;
  badge?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details open={defaultOpen} className="group overflow-hidden rounded-3xl border bg-card">
      <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-5 py-3 hover:bg-muted/50">
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 font-medium">
            {title}
            {badge}
          </span>
          {summary ? <span className="block text-sm text-muted-foreground">{summary}</span> : null}
        </span>
        <ChevronDownIcon className="size-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t px-5 py-4">{children}</div>
    </details>
  );
}

/** Label and value pairs, one per line; a missing value is said plainly. */
export function DetailList({ rows }: { rows: ReadonlyArray<{ label: string; value?: string }> }) {
  return (
    <dl className="divide-y">
      {rows.map((row) => (
        <div key={row.label} className="flex min-h-11 flex-wrap items-baseline justify-between gap-x-4 py-2">
          <dt className="text-sm text-muted-foreground">{row.label}</dt>
          <dd className={row.value ? "text-right" : "text-right text-muted-foreground"}>{row.value || "Not given"}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Attendance for one person, newest first. */
export function AttendanceHistoryPanel({
  entries,
  limit = 8,
}: {
  entries: ReadonlyArray<{ record: AttendanceRecord; session?: AttendanceSession }>;
  limit?: number;
}) {
  const present = entries.filter((entry) => entry.record.status === "present");

  return (
    <Disclosure
      title="When they came"
      summary={
        present.length
          ? `${present.length} time${present.length === 1 ? "" : "s"}, most recently ${formatDisplayDate(present[0]?.session?.date)}`
          : "Nothing recorded yet"
      }
    >
      {present.length ? (
        <>
          <ul className="divide-y">
            {present.slice(0, limit).map((entry) => (
              <li key={entry.record.id} className="flex min-h-12 flex-wrap items-center justify-between gap-2 py-2">
                <div>
                  <p className="font-medium">{entry.session?.name ?? "A service no longer on record"}</p>
                  <p className="text-sm text-muted-foreground">
                    {formatDisplayDate(entry.session?.date)} · {CHECK_IN_METHOD_LABELS[entry.record.method]}
                    {entry.record.corrections.length
                      ? ` · corrected ${entry.record.corrections.length} time${entry.record.corrections.length === 1 ? "" : "s"}`
                      : ""}
                  </p>
                </div>
                {entry.record.firstVisit ? (
                  <span className="rounded-full bg-primary/12 px-3 py-1 text-sm font-medium text-primary dark:text-foreground">
                    First visit
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="pt-3 text-xs text-muted-foreground">Only shown here, never on shared reports.</p>
        </>
      ) : (
        <p className="text-muted-foreground">Nobody has checked them in yet.</p>
      )}
    </Disclosure>
  );
}

/** Messages to one person, and what happened to each. */
export function CommunicationsPanel({
  entries,
  limit = 3,
}: {
  entries: readonly CommunicationLogEntry[];
  limit?: number;
}) {
  if (!entries.length) return null;

  return (
    <section className="space-y-3">
      <h2 className="text-xl font-medium">Messages</h2>
      <ul className="divide-y overflow-hidden rounded-3xl border bg-card">
        {entries.slice(0, limit).map((entry) => (
          <li key={entry.id} className="space-y-1 px-5 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium">{COMMUNICATION_STATUS_LABELS[entry.status]}</span>
              <span className="text-sm text-muted-foreground">{formatDisplayDateTime(entry.at)}</span>
            </div>
            <p className="line-clamp-2 text-muted-foreground">{entry.body}</p>
          </li>
        ))}
      </ul>
      {entries.length > limit ? (
        <p className="text-sm text-muted-foreground">
          And {entries.length - limit} earlier message{entries.length - limit === 1 ? "" : "s"}, listed in
          Everything that&apos;s happened.
        </p>
      ) : null}
    </section>
  );
}

/** Follow-ups already finished, as a short list: what, how it ended, when. */
export function FinishedFollowUps({ tasks, limit = 3 }: { tasks: readonly TaskWithPerson[]; limit?: number }) {
  if (!tasks.length) return null;
  const sorted = [...tasks].sort((left, right) =>
    (right.task.completedAt ?? right.task.dueDate).localeCompare(left.task.completedAt ?? left.task.dueDate),
  );

  const row = ({ task }: TaskWithPerson) => (
    <li key={task.id} className="flex min-h-14 flex-wrap items-center justify-between gap-x-3 gap-y-0.5 px-5 py-3">
      <span className="min-w-0">
        <span className="block font-medium">{FOLLOW_UP_TASK_TYPE_LABELS[task.type]}</span>
        {task.outcomeNote ? (
          <span className="block text-sm text-muted-foreground">“{task.outcomeNote}”</span>
        ) : null}
      </span>
      <span className="text-sm text-muted-foreground">
        {task.status === "cancelled" ? "Stopped" : task.outcome ? TASK_OUTCOME_LABELS[task.outcome] : "Done"}
        {task.completedAt ? ` · ${formatDisplayDate(task.completedAt)}` : ""}
      </span>
    </li>
  );

  return (
    <section className="space-y-3">
      <h2 className="text-xl font-medium">Done already</h2>
      <ul className="divide-y overflow-hidden rounded-3xl border bg-card">{sorted.slice(0, limit).map(row)}</ul>
      {sorted.length > limit ? (
        <Disclosure title={`${sorted.length - limit} more`}>
          <ul className="-mx-5 -my-4 divide-y">{sorted.slice(limit).map(row)}</ul>
        </Disclosure>
      ) : null}
    </section>
  );
}

/** Everything recorded against them, with a note when care entries are hidden. */
export function TimelinePanel({
  events,
  now,
  restrictedHidden,
}: {
  events: readonly ActivityEvent[];
  now: Date;
  restrictedHidden: boolean;
}) {
  return (
    <Disclosure
      title="Everything that's happened"
      summary={events.length ? `${events.length} thing${events.length === 1 ? "" : "s"} noted` : "Nothing yet"}
    >
      {restrictedHidden ? (
        <p className="mb-3 flex items-center gap-1.5 text-sm text-muted-foreground">
          <LockIcon className="size-3.5" />
          Pastoral care isn&apos;t shown to your role.
        </p>
      ) : null}
      <ActivityFeed events={events} now={now} emptyMessage="Nothing has been noted for them yet." />
    </Disclosure>
  );
}
