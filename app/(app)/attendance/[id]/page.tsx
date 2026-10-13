"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  CheckIcon,
  QrCodeIcon,
  UploadIcon,
  UserPlusIcon,
  UndoIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LinkButton } from "@/components/shared/link-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CorrectionDialog, CsvImportDialog } from "@/components/attendance/session-dialogs";
import { EmptyState } from "@/components/shared/empty-state";
import { PersonCell, personHref } from "@/components/shared/person-cell";
import { PageHeader, PageShell, Section } from "@/components/shared/page-header";
import { StatTile } from "@/components/shared/metric-card";
import { formatDisplayDate } from "@/lib/dates";
import { displayName, normalise } from "@/lib/strings";
import { CHECK_IN_METHOD_LABELS, SERVICE_TYPE_LABELS } from "@/types/attendance";
import { useAttendance, useSession } from "@/hooks/useAttendance";
import { useDemoRole } from "@/hooks/useDemoRole";

/**
 * Check-in for one session.
 *
 * Several ways in — search, manual entry, a new visitor, a CSV import or the
 * demo QR flow — all of which end up as the same kind of attendance record.
 */
export default function SessionPage() {
  const params = useParams<{ id: string }>();
  const sessionId = params.id;

  const { session, summary, present, removed, notPresent } = useSession(sessionId);
  const { sessions, checkIn, correctRemove, moveRecord, importCsv, saveNotes } = useAttendance();
  const { can } = useDemoRole();

  const [search, setSearch] = useState("");
  const [importing, setImporting] = useState(false);
  const [notes, setNotes] = useState(session?.notes ?? "");
  const [correcting, setCorrecting] = useState<{ recordId: string; name: string } | null>(null);

  const canEdit = can("attendance.write");

  const candidates = useMemo(() => {
    const needle = normalise(search);
    if (!needle) return notPresent.slice(0, 12);
    return notPresent
      .filter((person) =>
        normalise(
          `${person.firstName} ${person.lastName} ${person.phone ?? ""} ${person.member?.reference ?? ""}`,
        ).includes(needle),
      )
      .slice(0, 20);
  }, [notPresent, search]);

  if (!session) {
    return (
      <PageShell>
        <EmptyState
          title="That session no longer exists"
          description="It may have been removed. Go back to attendance to pick another."
          action={
            <LinkButton size="sm" href="/attendance">
              Back to attendance
            </LinkButton>
          }
        />
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PageHeader
        title={session.name}
        description={`${formatDisplayDate(session.date)} · ${session.startTime} · ${SERVICE_TYPE_LABELS[session.type]}`}
        actions={
          canEdit ? (
            <>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => setImporting(true)}
              >
                <UploadIcon />
                Import CSV
              </Button>
              <LinkButton variant="outline" size="sm" href="/visitors/quick" className="gap-1.5">
                <UserPlusIcon />
                Add a first-time visitor
              </LinkButton>
              <LinkButton size="sm" href="/connect" target="_blank" className="gap-1.5">
                <QrCodeIcon />
                QR check-in (demo)
              </LinkButton>
            </>
          ) : null
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Present" value={summary?.total ?? 0} detail="Counted from records" />
        <StatTile label="Members" value={summary?.members ?? 0} />
        <StatTile label="Visitors" value={summary?.visitors ?? 0} />
        <StatTile
          label="First-time visitors"
          value={summary?.firstTimeVisitors ?? 0}
          detail="On their own first visit"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {canEdit ? (
          <Card>
            <CardHeader>
              <CardTitle>Check someone in</CardTitle>
              <CardDescription>
                Search the directory. Checking the same person in twice is refused rather than
                silently duplicated.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search name, phone or member ID"
                aria-label="Search people to check in"
              />
              <ul className="max-h-80 space-y-1.5 overflow-y-auto">
                {candidates.map((person) => (
                  <li
                    key={person.id}
                    className="flex items-center justify-between gap-2 rounded-lg border p-2"
                  >
                    <PersonCell
                      person={person}
                      href={personHref(person)}
                      subtitle={
                        person.member
                          ? `Member ${person.member.reference}`
                          : (person.phone ?? "Visitor")
                      }
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5"
                      onClick={() => checkIn(sessionId, person.id, "search")}
                    >
                      <CheckIcon />
                      Check in
                    </Button>
                  </li>
                ))}
                {!candidates.length ? (
                  <li className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                    {search
                      ? "Nobody matches that search. Register them as a visitor instead."
                      : "Everyone in the directory is already checked in."}
                  </li>
                ) : null}
              </ul>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Present ({present.length})</CardTitle>
            <CardDescription>
              Corrections keep the record and note what changed.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {present.length ? (
              <ul className="max-h-96 space-y-1.5 overflow-y-auto">
                {present.map(({ record, person }) => (
                  <li
                    key={record.id}
                    className="flex items-center justify-between gap-2 rounded-lg border p-2"
                  >
                    <div className="min-w-0">
                      {person ? (
                        <PersonCell
                          person={person}
                          href={personHref(person)}
                          subtitle={CHECK_IN_METHOD_LABELS[record.method]}
                        />
                      ) : (
                        <p className="text-sm text-muted-foreground">Unknown person</p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {record.firstVisit ? <Badge variant="secondary">First visit</Badge> : null}
                      {canEdit ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setCorrecting({
                              recordId: record.id,
                              name: person ? displayName(person) : "this person",
                            })
                          }
                        >
                          Correct
                        </Button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Nobody has been checked in yet.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {removed.length ? (
        <Section
          title="Corrected records"
          description="Removed rather than deleted, so the correction history stays visible."
        >
          <ul className="space-y-1.5">
            {removed.map(({ record, person }) => (
              <li
                key={record.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2 text-sm"
              >
                <span>
                  {person ? displayName(person) : "Unknown person"}
                  <span className="ml-2 text-xs text-muted-foreground">
                    {record.corrections.at(-1)?.reason ?? "No reason recorded"}
                  </span>
                </span>
                {canEdit ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => checkIn(sessionId, record.personId, "manual")}
                  >
                    <UndoIcon />
                    Restore
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {canEdit ? (
        <Card>
          <CardHeader>
            <CardTitle>Session notes</CardTitle>
            <CardDescription>
              Practical notes about the session. Keep personal detail off this page.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Textarea
              rows={3}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              aria-label="Session notes"
            />
            <Button size="sm" variant="outline" onClick={() => saveNotes(sessionId, notes)}>
              Save notes
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <CsvImportDialog
        open={importing}
        onOpenChange={setImporting}
        onConfirm={async (csv) => {
          const outcome = await importCsv(sessionId, csv);
          if (outcome.ok) setImporting(false);
        }}
      />

      {correcting ? (
        <CorrectionDialog
          open
          onOpenChange={(open) => !open && setCorrecting(null)}
          personName={correcting.name}
          sessions={sessions.map((entry) => ({
            id: entry.id,
            name: entry.name,
            date: entry.date,
          }))}
          currentSessionId={sessionId}
          onRemove={(reason) => {
            correctRemove(correcting.recordId, reason);
            setCorrecting(null);
          }}
          onMove={(targetSessionId, reason) => {
            moveRecord(correcting.recordId, targetSessionId, reason);
            setCorrecting(null);
          }}
        />
      ) : null}
    </PageShell>
  );
}
