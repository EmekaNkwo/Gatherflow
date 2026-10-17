"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ChevronLeftIcon, UserPlusIcon } from "lucide-react";
import { LinkButton } from "@/components/shared/link-button";
import { CorrectionDialog, CsvImportDialog } from "@/components/attendance/session-dialogs";
import { CheckInSearch } from "@/components/attendance/check-in-search";
import { HereList, type HereEntry } from "@/components/attendance/here-list";
import { ServiceExtras } from "@/components/attendance/service-extras";
import { EmptyState } from "@/components/shared/empty-state";
import { PageShell, Section } from "@/components/shared/page-header";
import { formatDisplayDate } from "@/lib/dates";
import { displayName } from "@/lib/strings";
import { useAttendance, useSession } from "@/hooks/useAttendance";
import { useRole } from "@/hooks/useRole";

/** The reason noted when a check-in is undone straight from the list. */
const UNDO_REASON = "Undone at check-in";

/**
 * Check-in for one service, built for a volunteer at the door: find a name,
 * tap once, and they're on the list. Undo is right beside each name; moving
 * a check-in, importing a list and notes sit under "More for this service".
 */
export default function SessionPage() {
  const params = useParams<{ id: string }>();
  const sessionId = params.id;

  const { session, summary, present, removed, notPresent } = useSession(sessionId);
  const { sessions, checkIn, correctRemove, moveRecord, importCsv, saveNotes } = useAttendance();
  const { can } = useRole();

  const [importing, setImporting] = useState(false);
  const [fixing, setFixing] = useState<HereEntry | null>(null);

  const canEdit = can("attendance.write");

  if (!session) {
    return (
      <PageShell>
        <EmptyState
          title="That service isn’t here any more"
          description="It may have been removed. Go back to check-in to pick another."
          action={
            <LinkButton size="lg" className="rounded-full" href="/attendance">
              Back to check-in
            </LinkButton>
          }
        />
      </PageShell>
    );
  }

  const total = summary?.total ?? present.length;
  const firstTime = summary?.firstTimeVisitors ?? 0;

  return (
    <PageShell className="max-w-3xl space-y-6">
      <div className="space-y-2">
        <Link
          href="/attendance"
          className="-ml-2 inline-flex min-h-11 items-center gap-1 rounded-full px-2 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <ChevronLeftIcon className="size-4" />
          All services
        </Link>
        <div className="space-y-1">
          <h1 className="text-[1.75rem] leading-tight font-medium md:text-3xl">{session.name}</h1>
          <p className="text-muted-foreground">
            {formatDisplayDate(session.date)} at {session.startTime}
          </p>
        </div>
      </div>

      <section
        aria-label="Who’s here"
        className="flex flex-wrap items-end justify-between gap-4 rounded-[2rem] bg-warm px-6 py-5 md:px-8"
      >
        <div aria-live="polite">
          <p className="flex items-baseline gap-2">
            <span className="font-heading text-5xl leading-none font-medium tabular-nums">{total}</span>
            <span className="text-lg">here so far</span>
          </p>
          {total ? (
            <p className="mt-2 text-sm text-muted-foreground">
              {summary?.members ?? 0} members · {summary?.visitors ?? 0} visitors
              {firstTime ? ` · ${firstTime} here for the first time` : ""}
            </p>
          ) : null}
        </div>
        {canEdit ? (
          <LinkButton
            variant="outline"
            size="lg"
            href="/visitors/quick"
            className="shrink-0 rounded-full bg-background"
          >
            <UserPlusIcon />
            Someone new
          </LinkButton>
        ) : null}
      </section>

      {canEdit ? (
        <CheckInSearch notPresent={notPresent} onCheckIn={(person) => checkIn(sessionId, person.id, "search")} />
      ) : null}

      <Section title="Here so far">
        <HereList
          entries={present}
          canEdit={canEdit}
          onUndo={(entry) => correctRemove(entry.record.id, UNDO_REASON)}
          onFix={setFixing}
        />
      </Section>

      <ServiceExtras
        key={session.id}
        canEdit={canEdit}
        initialNotes={session.notes ?? ""}
        removed={removed}
        onImport={() => setImporting(true)}
        onRestore={(entry) => checkIn(sessionId, entry.record.personId, "manual")}
        onSaveNotes={(notes) => saveNotes(sessionId, notes)}
      />

      <CsvImportDialog
        open={importing}
        onOpenChange={setImporting}
        onConfirm={async (csv) => {
          const outcome = await importCsv(sessionId, csv);
          if (outcome.ok) setImporting(false);
        }}
      />

      {fixing ? (
        <CorrectionDialog
          open
          onOpenChange={(open) => !open && setFixing(null)}
          personName={fixing.person ? displayName(fixing.person) : "this person"}
          sessions={sessions.map((entry) => ({ id: entry.id, name: entry.name, date: entry.date }))}
          currentSessionId={sessionId}
          onRemove={(reason) => {
            correctRemove(fixing.record.id, reason);
            setFixing(null);
          }}
          onMove={(targetSessionId, reason) => {
            moveRecord(fixing.record.id, targetSessionId, reason);
            setFixing(null);
          }}
        />
      ) : null}
    </PageShell>
  );
}
