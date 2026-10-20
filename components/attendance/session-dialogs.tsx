"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/shared/select-field";
import { Textarea } from "@/components/ui/textarea";
import { useIsMobile } from "@/hooks/use-mobile";
import { formatDisplayDate } from "@/lib/dates";
import { SERVICE_TYPES, SERVICE_TYPE_LABELS, type ServiceType } from "@/types/attendance";
import {
  EARLIEST_SESSION_DATE,
  latestSessionDate,
  type CreateSessionInput,
} from "@/services/attendance/sessions";
import type { CsvImportSummary } from "@/services/attendance/csv-import";

const SERVICE_TYPE_OPTIONS = SERVICE_TYPES.map((option) => ({ value: option, label: SERVICE_TYPE_LABELS[option] }));

interface AdaptiveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer: ReactNode;
}

/**
 * A sheet from the bottom on a phone, a dialog on a wide screen, with the
 * buttons always in reach at the bottom.
 */
function AdaptiveDialog({ open, onOpenChange, title, description, children, footer }: AdaptiveDialogProps) {
  const isMobile = useIsMobile();

  const body = (
    <>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-3 sm:px-6">{children}</div>
      <div className="flex gap-2 border-t bg-popover px-5 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6">
        {footer}
      </div>
    </>
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="max-h-[92dvh] gap-0 rounded-t-3xl px-0 pb-0">
          <SheetHeader className="px-5 pt-5 pb-2 text-left">
            <SheetTitle className="font-heading text-2xl font-medium">{title}</SheetTitle>
            {description ? <SheetDescription>{description}</SheetDescription> : null}
          </SheetHeader>
          {open ? body : null}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-md">
        <DialogHeader className="px-6 pt-6 pb-2">
          <DialogTitle className="font-heading text-2xl font-medium">{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        {open ? body : null}
      </DialogContent>
    </Dialog>
  );
}

/** What the service form starts from: a new service, or one being corrected. */
export type SessionFormValues = Omit<CreateSessionInput, "groupId">;

interface CreateSessionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  today: string;
  /** Resolves once the save has finished, so the button can wait for it. */
  onConfirm: (input: CreateSessionInput) => Promise<unknown> | void;
}

/** Adds a service, event or meeting that people can be checked in to. */
export function CreateSessionDialog({ open, onOpenChange, today, onConfirm }: CreateSessionDialogProps) {
  // Keyed on `open`, so every new service starts from a clean form.
  return (
    <SessionForm
      key={String(open)}
      open={open}
      today={today}
      title="Add a service"
      description="It will be ready for check-in on the day."
      confirmLabel="Add service"
      initial={{ name: "Sunday service", date: today, startTime: "10:00", type: "sunday_service", notes: "" }}
      onOpenChange={onOpenChange}
      onConfirm={onConfirm}
    />
  );
}

interface EditSessionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  today: string;
  session: SessionFormValues & { id: string };
  onConfirm: (input: CreateSessionInput) => Promise<unknown> | void;
}

/** Corrects a service's name, date, time or kind. */
export function EditSessionDialog({ open, onOpenChange, today, session, onConfirm }: EditSessionDialogProps) {
  return (
    <SessionForm
      key={`${session.id}:${String(open)}`}
      open={open}
      today={today}
      title="Change this service"
      description="Fix a name, date or time that was entered wrongly."
      confirmLabel="Save changes"
      initial={session}
      onOpenChange={onOpenChange}
      onConfirm={onConfirm}
    />
  );
}

interface SessionFormProps {
  open: boolean;
  today: string;
  title: string;
  description: string;
  confirmLabel: string;
  initial: SessionFormValues;
  onOpenChange: (open: boolean) => void;
  onConfirm: (input: CreateSessionInput) => Promise<unknown> | void;
}

function SessionForm({
  open,
  today,
  title,
  description,
  confirmLabel,
  initial,
  onOpenChange,
  onConfirm,
}: SessionFormProps) {
  const [name, setName] = useState(initial.name);
  const [date, setDate] = useState(initial.date);
  const [startTime, setStartTime] = useState(initial.startTime);
  const [type, setType] = useState<ServiceType>(initial.type);
  const [notes, setNotes] = useState(initial.notes ?? "");
  const [saving, setSaving] = useState(false);

  const latest = latestSessionDate(today);
  const dateProblem = !date
    ? "Pick a date."
    : date < EARLIEST_SESSION_DATE
      ? "That date is too far back."
      : date > latest
        ? `That date is too far ahead. Pick a date before ${formatDisplayDate(latest)}.`
        : null;

  const submit = async () => {
    if (saving || !name.trim() || dateProblem || !startTime) return;
    setSaving(true);
    try {
      await onConfirm({ name, date, startTime, type, notes: notes.trim() || undefined });
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdaptiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="ghost" size="lg" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="lg"
            className="flex-1"
            disabled={saving || !name.trim() || Boolean(dateProblem) || !startTime}
            onClick={submit}
          >
            {saving ? "Saving…" : confirmLabel}
          </Button>
        </>
      }
    >
      <Field>
        <FieldLabel htmlFor="session-name">What is it called?</FieldLabel>
        <Input id="session-name" className="h-11" value={name} onChange={(event) => setName(event.target.value)} />
        <FieldDescription>
          Two gatherings of the same kind at the same time on the same day aren’t allowed.
        </FieldDescription>
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field data-invalid={dateProblem ? true : undefined}>
          <FieldLabel htmlFor="session-date">Date</FieldLabel>
          <Input
            id="session-date"
            type="date"
            className="h-11"
            min={EARLIEST_SESSION_DATE}
            max={latest}
            value={date}
            aria-invalid={dateProblem ? true : undefined}
            aria-describedby={dateProblem ? "session-date-problem" : undefined}
            onChange={(event) => setDate(event.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="session-time">Starts at</FieldLabel>
          <Input
            id="session-time"
            type="time"
            className="h-11"
            value={startTime}
            onChange={(event) => setStartTime(event.target.value)}
          />
        </Field>
      </div>
      {dateProblem && date ? (
        <p id="session-date-problem" role="alert" className="text-sm text-destructive">
          {dateProblem}
        </p>
      ) : null}

      <SelectField
        id="session-type"
        label="Kind of gathering"
        value={type}
        onValueChange={(value) => setType(value as ServiceType)}
        options={SERVICE_TYPE_OPTIONS}
      />

      <Field>
        <FieldLabel htmlFor="session-notes">Notes (optional)</FieldLabel>
        <Textarea id="session-notes" rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />
      </Field>
    </AdaptiveDialog>
  );
}

interface DeleteSessionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionName: string;
  sessionDate: string;
  /** How many people are checked in; a service with anybody here can't be deleted. */
  present: number;
  onConfirm: () => Promise<unknown> | void;
}

/** Deletes a service added by mistake, once nobody is checked in to it. */
export function DeleteSessionDialog({
  open,
  onOpenChange,
  sessionName,
  sessionDate,
  present,
  onConfirm,
}: DeleteSessionDialogProps) {
  const [deleting, setDeleting] = useState(false);
  const blocked = present > 0;

  const confirm = async () => {
    if (deleting || blocked) return;
    setDeleting(true);
    try {
      await onConfirm();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <AdaptiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Delete ${sessionName}?`}
      description={formatDisplayDate(sessionDate)}
      footer={
        <>
          <Button variant="ghost" size="lg" onClick={() => onOpenChange(false)}>
            {blocked ? "Close" : "Keep it"}
          </Button>
          {blocked ? null : (
            <Button size="lg" variant="destructive" className="flex-1" disabled={deleting} onClick={confirm}>
              {deleting ? "Deleting…" : "Delete service"}
            </Button>
          )}
        </>
      }
    >
      <p>
        {blocked
          ? `${present === 1 ? "1 person is" : `${present} people are`} checked in to this service, so it can’t be deleted. Move or undo those check-ins first.`
          : "Use this for a service that was added by mistake. It can’t be brought back."}
      </p>
    </AdaptiveDialog>
  );
}

interface CsvImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Resolves with what was imported, or `null` when the import was refused. */
  onConfirm: (csv: string) => Promise<CsvImportSummary | null>;
}

/**
 * Imports an attendance list. Rows that do not match anybody are listed
 * afterwards rather than guessed at, and no new people are created.
 */
export function CsvImportDialog({ open, onOpenChange, onConfirm }: CsvImportDialogProps) {
  const [csv, setCsv] = useState("name,phone\n");
  const [importing, setImporting] = useState(false);
  const [unmatched, setUnmatched] = useState<readonly string[] | null>(null);

  const close = (next: boolean) => {
    if (!next) {
      setUnmatched(null);
      setCsv("name,phone\n");
    }
    onOpenChange(next);
  };

  const submit = async () => {
    if (importing) return;
    setImporting(true);
    try {
      const summary = await onConfirm(csv);
      if (!summary) return;
      if (summary.unmatched.length) setUnmatched(summary.unmatched);
      else close(false);
    } finally {
      setImporting(false);
    }
  };

  return (
    <AdaptiveDialog
      open={open}
      onOpenChange={close}
      title={unmatched ? "Some rows didn’t match" : "Import a list"}
      description={
        unmatched ? (
          "Everyone else was checked in. Nobody new was created for these rows."
        ) : (
          <>
            Paste a list with a <code>name</code> column and, if you have it, a <code>phone</code> column.
          </>
        )
      }
      footer={
        unmatched ? (
          <Button size="lg" className="flex-1" onClick={() => close(false)}>
            Done
          </Button>
        ) : (
          <>
            <Button variant="ghost" size="lg" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button size="lg" className="flex-1" disabled={importing || !csv.trim()} onClick={submit}>
              {importing ? "Importing…" : "Import"}
            </Button>
          </>
        )
      }
    >
      {unmatched ? (
        <section aria-label="Rows that didn’t match anyone" className="space-y-2">
          <p>
            {unmatched.length === 1 ? "1 row" : `${unmatched.length} rows`} didn’t match anyone in the
            directory. Check the spelling, or welcome them as someone new.
          </p>
          <ul className="max-h-60 divide-y overflow-y-auto rounded-2xl bg-muted">
            {unmatched.map((row, index) => (
              <li key={`${row}-${index}`} className="px-4 py-2.5">
                {row}
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <Field>
          <FieldLabel htmlFor="csv-body">List</FieldLabel>
          <Textarea
            id="csv-body"
            rows={8}
            value={csv}
            onChange={(event) => setCsv(event.target.value)}
            className="font-mono text-xs"
          />
          <FieldDescription>
            The first line names the columns. Commas or semicolons both work. We match people by phone
            number first, then by exact name. Nobody new is created; rows we can’t match are listed so
            you can check them.
          </FieldDescription>
        </Field>
      )}
    </AdaptiveDialog>
  );
}

interface CorrectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  personName: string;
  sessions: ReadonlyArray<{ id: string; name: string; date: string }>;
  currentSessionId: string;
  onRemove: (reason: string | undefined) => void;
  onMove: (sessionId: string, reason: string | undefined) => void;
}

/** Fixes a check-in, keeping a note of what changed. */
export function CorrectionDialog({
  open,
  onOpenChange,
  personName,
  sessions,
  currentSessionId,
  onRemove,
  onMove,
}: CorrectionDialogProps) {
  const [reason, setReason] = useState("");
  const [target, setTarget] = useState(currentSessionId);
  const moving = target !== currentSessionId;

  return (
    <AdaptiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Fix the check-in for ${personName}`}
      description="Nothing is erased. The change is noted on the record."
      footer={
        <>
          <Button variant="ghost" size="lg" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {moving ? (
            <Button size="lg" className="flex-1" onClick={() => onMove(target, reason.trim() || undefined)}>
              Move to that service
            </Button>
          ) : (
            <Button
              size="lg"
              variant="destructive"
              className="flex-1"
              onClick={() => onRemove(reason.trim() || undefined)}
            >
              They weren’t here
            </Button>
          )}
        </>
      }
    >
      <SelectField
        id="correction-session"
        label="Which service were they at?"
        value={target}
        onValueChange={setTarget}
        options={sessions.map((session) => ({
          value: session.id,
          label: session.id === currentSessionId ? "This one (or none)" : `${session.name} · ${formatDisplayDate(session.date)}`,
        }))}
        description={
          moving ? "Their check-in moves to the service you picked." : "Pick another service to move them, or leave this to remove the check-in."
        }
      />

      <Field>
        <FieldLabel htmlFor="correction-reason">Why? (optional)</FieldLabel>
        <Input
          id="correction-reason"
          className="h-11"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Checked in by mistake"
        />
      </Field>
    </AdaptiveDialog>
  );
}
