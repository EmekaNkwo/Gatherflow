"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CalendarPlusIcon, ChevronDownIcon, LockIcon, PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { Textarea } from "@/components/ui/textarea";
import { CareStatusBadge, RestrictedBadge } from "@/components/shared/badges";
import { EmptyState, RestrictedState } from "@/components/shared/empty-state";
import { PageHeader, PageShell, Section } from "@/components/shared/page-header";
import { SelectField, type SelectOption } from "@/components/shared/select-field";
import { formatDisplayDate, toIsoDate } from "@/lib/dates";
import { displayName, normalise } from "@/lib/strings";
import {
  CARE_CATEGORY_LABELS,
  CARE_STATUSES,
  CARE_STATUS_LABELS,
  type CareCategory,
  type CareStatus,
} from "@/types/care";
import { useRole } from "@/hooks/useRole";
import { useNow } from "@/hooks/use-now";
import { usePastoralCare } from "@/hooks/usePastoralCare";
import { useSnapshot } from "@/hooks/use-church-data";

const CARE_STATUS_OPTIONS: SelectOption[] = CARE_STATUSES.map((status) => ({
  value: status,
  label: CARE_STATUS_LABELS[status],
}));

const CARE_CATEGORY_OPTIONS: SelectOption[] = (Object.keys(CARE_CATEGORY_LABELS) as CareCategory[]).map(
  (option) => ({ value: option, label: CARE_CATEGORY_LABELS[option] }),
);

/**
 * Pastoral care, restricted to pastors: the people being cared for now
 * first, one clear way to record a new need, and finished care tucked away.
 *
 * Records keep a short, non-clinical summary; anything more detailed goes in
 * notes that are marked restricted and never leave this section.
 */
export default function PastoralCarePage() {
  const params = useSearchParams();
  const now = useNow();
  const snapshot = useSnapshot();
  const { teamMemberId } = useRole();
  const care = usePastoralCare();

  const [creating, setCreating] = useState(params.get("new") === "1");
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [appointmentFor, setAppointmentFor] = useState<string | null>(null);
  const [showClosed, setShowClosed] = useState(false);

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
  const awaiting = open.filter((entry) => entry.record.status === "awaiting_response").length;

  return (
    <PageShell className="max-w-4xl space-y-10">
      <PageHeader
        title="Pastoral care"
        description="Practical support, appointments and what to do next, kept private."
        actions={
          <Button size="lg" className="gap-2 rounded-full" onClick={() => setCreating(true)}>
            <PlusIcon />
            Record a care need
          </Button>
        }
      />

      <div className="flex gap-3 rounded-2xl bg-muted px-4 py-3 text-sm">
        <LockIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="space-y-1">
          <p className="flex flex-wrap items-center gap-2 font-medium">
            Only pastors can see this
            <RestrictedBadge />
          </p>
          <p className="text-muted-foreground">
            Nothing here appears in the activity feed, search or any export, and the server refuses care
            records to any role but a pastor&apos;s.
          </p>
        </div>
      </div>

      <Section
        title="Being cared for now"
        description={
          open.length
            ? `${open.length} open${awaiting ? `, ${awaiting} waiting to hear back` : ""}. ${care.appointments.length} ${care.appointments.length === 1 ? "appointment" : "appointments"} booked. Newest first.`
            : undefined
        }
      >
        {open.length ? (
          <ul className="space-y-4">
            {open.map(({ record, person, assignee }) => (
              <li key={record.id} className="space-y-4 rounded-3xl border bg-card p-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 className="font-heading text-xl font-medium">
                      {person ? displayName(person) : "Unknown person"}
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      {CARE_CATEGORY_LABELS[record.category]} · since {formatDisplayDate(record.receivedAt)} ·{" "}
                      {assignee ? `with ${assignee.name}` : "nobody caring for this yet"}
                    </p>
                  </div>
                  <CareStatusBadge status={record.status} />
                </div>

                <p>{record.summary}</p>

                {record.nextAction || record.appointments.length ? (
                  <ul className="space-y-1 text-sm">
                    {record.nextAction ? (
                      <li>
                        <span className="text-muted-foreground">Next: </span>
                        {record.nextAction}
                        {record.nextActionDate ? ` · ${formatDisplayDate(record.nextActionDate)}` : ""}
                      </li>
                    ) : null}
                    {record.appointments.map((appointment) => (
                      <li key={appointment.id}>
                        <span className="text-muted-foreground">Appointment: </span>
                        {formatDisplayDate(appointment.date)} at {appointment.time}
                        {appointment.location ? `, ${appointment.location}` : ""}
                        <span className="text-muted-foreground"> · {appointment.status}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}

                {record.notes.length ? (
                  <div className="space-y-1.5 rounded-2xl bg-muted px-4 py-3">
                    <p className="flex items-center gap-1.5 text-sm font-medium">
                      <LockIcon className="size-3.5" />
                      Restricted notes
                    </p>
                    {record.notes.map((entry) => (
                      <p key={entry.at} className="text-sm text-muted-foreground">
                        {entry.text}
                      </p>
                    ))}
                  </div>
                ) : null}

                <div className="flex flex-wrap items-center gap-2">
                  <SelectField
                    aria-label={`Status for ${record.reference}`}
                    value={record.status}
                    onValueChange={(value) => care.setStatus(record.id, value as CareStatus)}
                    className="w-auto"
                    options={CARE_STATUS_OPTIONS}
                  />
                  <Button variant="outline" className="min-h-11 rounded-full" onClick={() => setNoteFor(record.id)}>
                    Add a note
                  </Button>
                  <Button
                    variant="outline"
                    className="min-h-11 gap-1.5 rounded-full"
                    onClick={() => setAppointmentFor(record.id)}
                  >
                    <CalendarPlusIcon />
                    Schedule
                  </Button>
                  {!record.assigneeId ? (
                    <Button
                      variant="outline"
                      className="min-h-11 rounded-full"
                      onClick={() =>
                        care.update(record.id, {
                          assigneeId: teamMemberId ?? undefined,
                          status: "assigned",
                        })
                      }
                    >
                      I&apos;ll take this
                    </Button>
                  ) : null}
                  <span className="ml-auto text-xs text-muted-foreground">{record.reference}</span>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            title="Nobody needs care right now"
            description="When a care need is recorded, it shows here first."
          />
        )}
      </Section>

      {closed.length ? (
        <section className="space-y-3">
          <Button
            variant="ghost"
            className="min-h-11 gap-1.5 rounded-full px-4"
            aria-expanded={showClosed}
            aria-controls="care-closed"
            onClick={() => setShowClosed((value) => !value)}
          >
            {showClosed ? "Hide" : "Show"} resolved and closed ({closed.length})
            <ChevronDownIcon className={showClosed ? "rotate-180 transition-transform" : "transition-transform"} />
          </Button>
          {showClosed ? (
            <div id="care-closed" className="space-y-2">
              <p className="text-sm text-muted-foreground">Kept so care can carry on well if the need comes back.</p>
              <ul className="divide-y overflow-hidden rounded-3xl border bg-card">
                {closed.map(({ record, person }) => (
                  <li key={record.id} className="flex min-h-14 flex-wrap items-center justify-between gap-2 px-5 py-3">
                    <span className="min-w-0">
                      <span className="block font-medium">{person ? displayName(person) : "Unknown person"}</span>
                      <span className="block text-sm text-muted-foreground">
                        {CARE_CATEGORY_LABELS[record.category]} · {record.reference}
                      </span>
                    </span>
                    <span className="text-sm text-muted-foreground">{CARE_STATUS_LABELS[record.status]}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      <NewCareRecordDialog
        open={creating}
        onOpenChange={setCreating}
        today={toIsoDate(now)}
        people={snapshot.people}
        onConfirm={async (values) => {
          const outcome = await care.create(values);
          if (outcome.ok) setCreating(false);
        }}
      />

      <Dialog open={noteFor !== null} onOpenChange={(open) => !open && setNoteFor(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-2xl">
              Add a restricted note
              <RestrictedBadge />
            </DialogTitle>
            <DialogDescription>
              Keep it brief and practical. Notes stay inside pastoral care.
            </DialogDescription>
          </DialogHeader>
          <Textarea rows={4} value={note} onChange={(event) => setNote(event.target.value)} />
          <DialogFooter>
            <Button variant="ghost" className="min-h-11 rounded-full" onClick={() => setNoteFor(null)}>
              Cancel
            </Button>
            <Button
              className="min-h-11 rounded-full"
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
          <DialogTitle className="text-2xl">Record a care need</DialogTitle>
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
          <SelectField
            className="mt-2"
            aria-label="Select a person"
            value={personId}
            onValueChange={setPersonId}
            options={[
              { value: "", label: "Choose someone…" },
              ...matches.map((person) => ({ value: person.id, label: displayName(person) })),
            ]}
          />
        </Field>

        <SelectField
          id="care-category"
          label="Kind of care"
          value={category}
          onValueChange={(value) => setCategory(value as CareCategory)}
          options={CARE_CATEGORY_OPTIONS}
        />

        <Field>
          <FieldLabel htmlFor="care-summary">Short description</FieldLabel>
          <Input
            id="care-summary"
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            placeholder="Needs help with transport to Sunday services"
          />
          <FieldDescription>
            Keep it general. It is the first line other pastors see.
          </FieldDescription>
        </Field>

        <Field>
          <FieldLabel htmlFor="care-next">What happens next</FieldLabel>
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
          <Button variant="ghost" className="min-h-11 rounded-full" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            className="min-h-11 rounded-full"
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
            Save
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
          <DialogTitle className="text-2xl">Schedule an appointment</DialogTitle>
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
          <Button variant="ghost" className="min-h-11 rounded-full" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button className="min-h-11 rounded-full" onClick={() => onConfirm({ date, time, location: location || undefined })}>
            Schedule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
