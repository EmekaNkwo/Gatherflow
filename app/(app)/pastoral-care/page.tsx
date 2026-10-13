"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CalendarPlusIcon, LockIcon, PlusIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { CareStatusBadge, RestrictedBadge } from "@/components/shared/badges";
import { EmptyState, RestrictedState } from "@/components/shared/empty-state";
import { PageHeader, PageShell, Section } from "@/components/shared/page-header";
import { StatTile } from "@/components/shared/metric-card";
import { formatDisplayDate, toIsoDate } from "@/lib/dates";
import { displayName, normalise } from "@/lib/strings";
import {
  CARE_CATEGORY_LABELS,
  CARE_STATUSES,
  CARE_STATUS_LABELS,
  type CareCategory,
  type CareStatus,
} from "@/types/care";
import { useDemoRole } from "@/hooks/useDemoRole";
import { useNow } from "@/hooks/use-now";
import { usePastoralCare } from "@/hooks/usePastoralCare";
import { useSnapshot } from "@/hooks/use-church-data";

/**
 * Pastoral care, restricted to authorised demo roles.
 *
 * Records keep a short, non-clinical summary; anything more detailed goes in
 * notes that are marked restricted and never leave this section.
 */
export default function PastoralCarePage() {
  const params = useSearchParams();
  const now = useNow();
  const snapshot = useSnapshot();
  const { teamMemberId } = useDemoRole();
  const care = usePastoralCare();

  const [creating, setCreating] = useState(params.get("new") === "1");
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [appointmentFor, setAppointmentFor] = useState<string | null>(null);

  if (!care.authorised) {
    return (
      <PageShell>
        <RestrictedState section="Pastoral care" />
      </PageShell>
    );
  }

  const open = care.records.filter(
    (entry) => !["resolved", "closed"].includes(entry.record.status),
  );
  const closed = care.records.filter((entry) =>
    ["resolved", "closed"].includes(entry.record.status),
  );

  return (
    <PageShell>
      <PageHeader
        title="Pastoral care"
        description="Practical support requests, appointments and follow-up actions."
        actions={
          <Button size="sm" className="gap-1.5" onClick={() => setCreating(true)}>
            <PlusIcon />
            New care record
          </Button>
        }
      />

      <Alert>
        <LockIcon />
        <AlertTitle className="flex items-center gap-2">
          Restricted section
          <RestrictedBadge />
        </AlertTitle>
        <AlertDescription>
          Nothing here appears in the dashboard activity feed, global search or any export. In this
          demo the restriction is enforced in the browser only — a real deployment must enforce it
          on the server.
        </AlertDescription>
      </Alert>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Open records" value={open.length} />
        <StatTile
          label="Awaiting a response"
          value={open.filter((entry) => entry.record.status === "awaiting_response").length}
        />
        <StatTile label="Appointments scheduled" value={care.appointments.length} />
        <StatTile label="Resolved or closed" value={closed.length} />
      </div>

      <Section title={`Open (${open.length})`} description="Most recently received first.">
        {open.length ? (
          <ul className="space-y-3">
            {open.map(({ record, person, assignee }) => (
              <li key={record.id}>
                <Card>
                  <CardHeader>
                    <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
                      <span>
                        {record.reference} · {person ? displayName(person) : "Unknown person"}
                      </span>
                      <CareStatusBadge status={record.status} />
                    </CardTitle>
                    <CardDescription>
                      {CARE_CATEGORY_LABELS[record.category]} · received{" "}
                      {formatDisplayDate(record.receivedAt)} ·{" "}
                      {assignee ? assignee.name : "unassigned"}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <p>{record.summary}</p>

                    {record.nextAction ? (
                      <p className="text-xs text-muted-foreground">
                        Next: {record.nextAction}
                        {record.nextActionDate
                          ? ` · ${formatDisplayDate(record.nextActionDate)}`
                          : ""}
                      </p>
                    ) : null}

                    {record.appointments.length ? (
                      <ul className="space-y-1 text-xs text-muted-foreground">
                        {record.appointments.map((appointment) => (
                          <li key={appointment.id}>
                            {formatDisplayDate(appointment.date)} · {appointment.time}
                            {appointment.location ? ` · ${appointment.location}` : ""} ·{" "}
                            {appointment.status}
                          </li>
                        ))}
                      </ul>
                    ) : null}

                    {record.notes.length ? (
                      <div className="space-y-1.5 rounded-lg bg-muted/50 p-2">
                        <p className="flex items-center gap-1.5 text-xs font-medium">
                          <LockIcon className="size-3" />
                          Restricted notes
                        </p>
                        {record.notes.map((entry) => (
                          <p key={entry.at} className="text-xs text-muted-foreground">
                            {entry.text}
                          </p>
                        ))}
                      </div>
                    ) : null}

                    <div className="flex flex-wrap items-center gap-2">
                      <NativeSelect
                        size="sm"
                        aria-label={`Status for ${record.reference}`}
                        value={record.status}
                        onChange={(event) =>
                          care.setStatus(record.id, event.target.value as CareStatus)
                        }
                      >
                        {CARE_STATUSES.map((status) => (
                          <NativeSelectOption key={status} value={status}>
                            {CARE_STATUS_LABELS[status]}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                      <Button variant="outline" size="sm" onClick={() => setNoteFor(record.id)}>
                        Add a note
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        onClick={() => setAppointmentFor(record.id)}
                      >
                        <CalendarPlusIcon />
                        Schedule
                      </Button>
                      {!record.assigneeId ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            care.update(record.id, {
                              assigneeId: teamMemberId,
                              status: "assigned",
                            })
                          }
                        >
                          Assign to me
                        </Button>
                      ) : null}
                    </div>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            title="Nothing open"
            description="New care records appear here as soon as they are raised."
          />
        )}
      </Section>

      {closed.length ? (
        <Section title="Resolved and closed" description="Kept for continuity of care.">
          <ul className="space-y-2">
            {closed.map(({ record, person }) => (
              <li
                key={record.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2 text-sm"
              >
                <span>
                  {record.reference} · {person ? displayName(person) : "Unknown person"} ·{" "}
                  {CARE_CATEGORY_LABELS[record.category]}
                </span>
                <Badge variant="outline">{CARE_STATUS_LABELS[record.status]}</Badge>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <NewCareRecordDialog
        open={creating}
        onOpenChange={setCreating}
        today={toIsoDate(now)}
        people={snapshot.people}
        onConfirm={(values) => {
          const outcome = care.create(values);
          if (outcome.ok) setCreating(false);
        }}
      />

      <Dialog open={noteFor !== null} onOpenChange={(open) => !open && setNoteFor(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              Add a restricted note
              <RestrictedBadge />
            </DialogTitle>
            <DialogDescription>
              Keep it brief and practical. Notes stay inside pastoral care.
            </DialogDescription>
          </DialogHeader>
          <Textarea rows={4} value={note} onChange={(event) => setNote(event.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setNoteFor(null)}>
              Cancel
            </Button>
            <Button
              disabled={!note.trim()}
              onClick={() => {
                if (noteFor) care.addNote(noteFor, note);
                setNote("");
                setNoteFor(null);
              }}
            >
              Save note
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AppointmentDialog
        open={appointmentFor !== null}
        onOpenChange={(open) => !open && setAppointmentFor(null)}
        today={toIsoDate(now)}
        onConfirm={(values) => {
          if (appointmentFor) care.scheduleAppointment(appointmentFor, values);
          setAppointmentFor(null);
        }}
      />
    </PageShell>
  );
}

function NewCareRecordDialog({
  open,
  onOpenChange,
  today,
  people,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  today: string;
  people: ReturnType<typeof useSnapshot>["people"];
  onConfirm: (values: {
    personId: string;
    category: CareCategory;
    summary: string;
    receivedAt: string;
    nextAction?: string;
    note?: string;
  }) => void;
}) {
  const [search, setSearch] = useState("");
  const [personId, setPersonId] = useState("");
  const [category, setCategory] = useState<CareCategory>("practical_support");
  const [summary, setSummary] = useState("");
  const [nextAction, setNextAction] = useState("");
  const [note, setNote] = useState("");

  const matches = useMemo(() => {
    const needle = normalise(search);
    return people
      .filter(
        (person) =>
          !needle || normalise(`${person.firstName} ${person.lastName}`).includes(needle),
      )
      .slice(0, 30);
  }, [people, search]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New pastoral-care record</DialogTitle>
          <DialogDescription>
            Record only what is needed to help. No medical or financial detail.
          </DialogDescription>
        </DialogHeader>

        <Field>
          <FieldLabel htmlFor="care-search">Person</FieldLabel>
          <Input
            id="care-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by name"
          />
          <NativeSelect
            className="mt-2 w-full"
            aria-label="Select a person"
            value={personId}
            onChange={(event) => setPersonId(event.target.value)}
          >
            <NativeSelectOption value="">Choose someone…</NativeSelectOption>
            {matches.map((person) => (
              <NativeSelectOption key={person.id} value={person.id}>
                {displayName(person)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>

        <Field>
          <FieldLabel htmlFor="care-category">Category</FieldLabel>
          <NativeSelect
            className="w-full"
            id="care-category"
            value={category}
            onChange={(event) => setCategory(event.target.value as CareCategory)}
          >
            {(Object.keys(CARE_CATEGORY_LABELS) as CareCategory[]).map((option) => (
              <NativeSelectOption key={option} value={option}>
                {CARE_CATEGORY_LABELS[option]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>

        <Field>
          <FieldLabel htmlFor="care-summary">Short description</FieldLabel>
          <Input
            id="care-summary"
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            placeholder="Needs help with transport to Sunday services"
          />
          <FieldDescription>
            Keep this general — it is the line other authorised users will see first.
          </FieldDescription>
        </Field>

        <Field>
          <FieldLabel htmlFor="care-next">Next action</FieldLabel>
          <Input
            id="care-next"
            value={nextAction}
            onChange={(event) => setNextAction(event.target.value)}
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="care-note" className="flex items-center gap-2">
            First note <RestrictedBadge />
          </FieldLabel>
          <Textarea
            id="care-note"
            rows={3}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </Field>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!personId || !summary.trim()}
            onClick={() =>
              onConfirm({
                personId,
                category,
                summary,
                receivedAt: today,
                nextAction: nextAction.trim() || undefined,
                note: note.trim() || undefined,
              })
            }
          >
            Create record
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AppointmentDialog({
  open,
  onOpenChange,
  today,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  today: string;
  onConfirm: (values: { date: string; time: string; location?: string }) => void;
}) {
  const [date, setDate] = useState(today);
  const [time, setTime] = useState("15:00");
  const [location, setLocation] = useState("");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Schedule an appointment</DialogTitle>
          <DialogDescription>
            A general location only, such as &ldquo;Church office&rdquo;.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="appointment-date">Date</FieldLabel>
            <Input
              id="appointment-date"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="appointment-time">Time</FieldLabel>
            <Input
              id="appointment-time"
              type="time"
              value={time}
              onChange={(event) => setTime(event.target.value)}
            />
          </Field>
        </div>

        <Field>
          <FieldLabel htmlFor="appointment-location">Location</FieldLabel>
          <Input
            id="appointment-location"
            value={location}
            onChange={(event) => setLocation(event.target.value)}
          />
        </Field>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => onConfirm({ date, time, location: location || undefined })}>
            Schedule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
