"use client";

import { LockIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SimulatedBadge } from "@/components/shared/badges";
import { ActivityFeed } from "@/components/dashboard/activity-feed";
import {
  CHECK_IN_METHOD_LABELS,
  type AttendanceRecord,
  type AttendanceSession,
} from "@/types/attendance";
import { COMMUNICATION_STATUS_LABELS, type CommunicationLogEntry } from "@/types/communication";
import type { ActivityEvent } from "@/types/activity";
import { formatDisplayDate, formatDisplayDateTime } from "@/lib/dates";

/** Attendance history for one person, newest first. */
export function AttendanceHistoryPanel({
  entries,
  limit = 8,
}: {
  entries: ReadonlyArray<{ record: AttendanceRecord; session?: AttendanceSession }>;
  limit?: number;
}) {
  const present = entries.filter((entry) => entry.record.status === "present");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Attendance</CardTitle>
        <CardDescription>
          {present.length
            ? `${present.length} recorded attendance${present.length === 1 ? "" : "s"}. Shown here only — individual histories are not published to shared dashboards.`
            : "Nothing recorded yet."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {present.length ? (
          <ul className="space-y-2">
            {present.slice(0, limit).map((entry) => (
              <li
                key={entry.record.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2 text-sm"
              >
                <div>
                  <p className="font-medium">{entry.session?.name ?? "Unknown session"}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDisplayDate(entry.session?.date)} ·{" "}
                    {CHECK_IN_METHOD_LABELS[entry.record.method]}
                    {entry.record.corrections.length
                      ? ` · ${entry.record.corrections.length} correction${entry.record.corrections.length === 1 ? "" : "s"}`
                      : ""}
                  </p>
                </div>
                {entry.record.firstVisit ? <Badge variant="secondary">First visit</Badge> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            No attendance has been recorded for this person.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/** Communication log for one person. Always labelled as simulated. */
export function CommunicationsPanel({
  entries,
  limit = 6,
}: {
  entries: readonly CommunicationLogEntry[];
  limit?: number;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Messages
          <SimulatedBadge />
        </CardTitle>
        <CardDescription>
          What happened to each message. GatherFlow cannot confirm delivery, so it never claims it.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {entries.length ? (
          <ul className="space-y-2">
            {entries.slice(0, limit).map((entry) => (
              <li key={entry.id} className="rounded-lg border p-2 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Badge variant="outline">{COMMUNICATION_STATUS_LABELS[entry.status]}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {formatDisplayDateTime(entry.at)}
                  </span>
                </div>
                <p className="mt-1.5 line-clamp-3 text-muted-foreground">{entry.body}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No messages have been prepared yet.</p>
        )}
      </CardContent>
    </Card>
  );
}

/** Timeline panel, with a note when restricted entries are being hidden. */
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
    <Card>
      <CardHeader>
        <CardTitle>Timeline</CardTitle>
        <CardDescription className="flex items-center gap-1.5">
          {restrictedHidden ? (
            <>
              <LockIcon className="size-3.5" />
              Pastoral-care entries are hidden for this demo role.
            </>
          ) : (
            "Everything recorded against this person."
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ActivityFeed
          events={events}
          now={now}
          emptyMessage="Nothing has been recorded for this person yet."
        />
      </CardContent>
    </Card>
  );
}
