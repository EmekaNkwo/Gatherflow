"use client";

import { WelcomeButton } from "@/components/visitors/welcome-button";
import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ChevronLeftIcon, EllipsisIcon, UserPlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LinkButton } from "@/components/shared/link-button";
import {
  CorrectionDialog,
  CsvImportDialog,
  DeleteSessionDialog,
  EditSessionDialog,
} from "@/components/attendance/session-dialogs";
import { CheckInSearch } from "@/components/attendance/check-in-search";
import { HereList, type HereEntry } from "@/components/attendance/here-list";
import { ServiceExtras } from "@/components/attendance/service-extras";
import { EmptyState } from "@/components/shared/empty-state";
import { PageShell, Section } from "@/components/shared/page-header";
import { formatDisplayDate, toIsoDate } from "@/lib/dates";
import { displayName } from "@/lib/strings";
import type { CsvImportSummary } from "@/services/attendance/csv-import";
import { useAttendance, useSession } from "@/hooks/useAttendance";
import { useRole } from "@/hooks/useRole";
import { useNow } from "@/hooks/use-now";
import { useChurchStore } from "@/stores/church-store";

/** The reason noted when a check-in is undone straight from the list. */
const UNDO_REASON = "Undone at check-in";

/** "1 member", "3 visitors". */
function count(value: number, one: string, many: string): string {
  return `${value} ${value === 1 ? one : many}`;
}

/**
 * Check-in for one service, built for a volunteer at the door: find a name,
 * tap once, and they're on the list. Undo is right beside each name; moving
 * a check-in, importing a list and notes sit under "More for this service".
 * A service that hasn't happened yet can be looked at, but check-in opens on
 * the day.
 */
export default function SessionPage() {
  const params = useParams<{ id: string }>();
  const sessionId = params.id;
  const router = useRouter();
  const today = toIsoDate(useNow());
  const churchId = useChurchStore((state) => state.churchId);

  const { session, summary, present, removed, everyone } = useSession(sessionId);
  const { sessions, checkIn, correctRemove, moveRecord, importCsv, saveNotes, updateSession, deleteSession } =
    useAttendance();
  const { can, canRun } = useRole();

  const [importing, setImporting] = useState(false);
  const [fixing, setFixing] = useState<HereEntry | null>(null);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const canEdit = can("attendance.write");
  const canManage = canRun("session.delete", { sessionId });

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

  const upcoming = session.date > today;
  const canCheckIn = canEdit && !upcoming;
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
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1 space-y-1">
            <h1 className="text-[1.75rem] leading-tight font-medium md:text-3xl">{session.name}</h1>
            <p className="text-muted-foreground">
              {formatDisplayDate(session.date)} at {session.startTime}
            </p>
          </div>
          {canManage ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button size="icon-lg" variant="ghost" className="shrink-0 rounded-full" aria-label="Change or delete this service">
                    <EllipsisIcon />
                  </Button>
                }
              />
              <DropdownMenuContent align="end">
                <DropdownMenuItem className="min-h-11" onClick={() => setEditing(true)}>
                  Change name, date or time…
                </DropdownMenuItem>
                <DropdownMenuItem className="min-h-11" variant="destructive" onClick={() => setDeleting(true)}>
                  Delete this service…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </div>

      <section
        aria-label="Who’s here"
        className="flex flex-wrap items-end justify-between gap-4 rounded-[2rem] bg-warm px-6 py-5 md:px-8"
      >
        <div aria-live="polite">
          {upcoming ? (
            <p className="text-lg">Check-in opens on the day, {formatDisplayDate(session.date)}.</p>
          ) : (
            <p className="flex items-baseline gap-2">
              <span className="font-heading text-5xl leading-none font-medium tabular-nums">{total}</span>
              <span className="text-lg">here so far</span>
            </p>
          )}
          {total ? (
            <p className="mt-2 text-sm text-muted-foreground">
              {count(summary?.members ?? 0, "member", "members")} ·{" "}
              {count(summary?.visitors ?? 0, "visitor", "visitors")}
              {firstTime ? ` · ${firstTime} here for the first time` : ""}
            </p>
          ) : null}
        </div>
        {canCheckIn ? (
          <WelcomeButton variant="outline" size="lg" sessionId={sessionId} className="shrink-0 rounded-full bg-background">
            <UserPlusIcon />
            Someone new
          </WelcomeButton>
        ) : null}
      </section>

      {canCheckIn ? (
        <CheckInSearch
          sessionId={sessionId}
          people={everyone}
          present={present}
          onCheckIn={(person) => checkIn(sessionId, person.id, "search")}
          onUndo={(entry) => correctRemove(entry.record.id, UNDO_REASON)}
        />
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
        canEdit={canCheckIn}
        churchId={churchId}
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
          if (!outcome.ok) return null;
          return (outcome.value as { summary?: CsvImportSummary }).summary ?? null;
        }}
      />

      {canManage ? (
        <>
          <EditSessionDialog
            open={editing}
            onOpenChange={setEditing}
            today={today}
            session={{ ...session, notes: session.notes ?? "" }}
            onConfirm={async (input) => {
              const outcome = await updateSession({ ...input, sessionId, groupId: session.groupId });
              if (outcome.ok) setEditing(false);
            }}
          />
          <DeleteSessionDialog
            open={deleting}
            onOpenChange={setDeleting}
            sessionName={session.name}
            sessionDate={session.date}
            present={present.length}
            onConfirm={async () => {
              const outcome = await deleteSession(sessionId);
              if (outcome.ok) {
                setDeleting(false);
                router.push("/attendance");
              }
            }}
          />
        </>
      ) : null}

      {fixing ? (
        <CorrectionDialog
          open
          onOpenChange={(open) => !open && setFixing(null)}
          personName={fixing.person ? displayName(fixing.person) : "this person"}
          // Only services that have happened: nobody can have been at a future one.
          sessions={sessions
            .filter((entry) => entry.date <= today)
            .map((entry) => ({ id: entry.id, name: entry.name, date: entry.date }))}
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
