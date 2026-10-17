"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { useIsMobile } from "@/hooks/use-mobile";
import { formatDisplayDate } from "@/lib/dates";
import { SERVICE_TYPES, SERVICE_TYPE_LABELS, type ServiceType } from "@/types/attendance";
import type { CreateSessionInput } from "@/services/attendance/sessions";

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

interface CreateSessionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  today: string;
  onConfirm: (input: CreateSessionInput) => void;
}

/** Adds a service, event or meeting that people can be checked in to. */
export function CreateSessionDialog({ open, onOpenChange, today, onConfirm }: CreateSessionDialogProps) {
  // Keyed on `open`, so every new service starts from a clean form.
  return <SessionForm key={String(open)} open={open} today={today} onOpenChange={onOpenChange} onConfirm={onConfirm} />;
}

function SessionForm({
  open,
  today,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  today: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: (input: CreateSessionInput) => void;
}) {
  const [name, setName] = useState("Sunday service");
  const [date, setDate] = useState(today);
  const [startTime, setStartTime] = useState("10:00");
  const [type, setType] = useState<ServiceType>("sunday_service");
  const [notes, setNotes] = useState("");

  return (
    <AdaptiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add a service"
      description="It will be ready for check-in on the day."
      footer={
        <>
          <Button variant="ghost" size="lg" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="lg"
            className="flex-1"
            disabled={!name.trim() || !date}
            onClick={() => onConfirm({ name, date, startTime, type, notes: notes.trim() || undefined })}
          >
            Add service
          </Button>
        </>
      }
    >
      <Field>
        <FieldLabel htmlFor="session-name">What is it called?</FieldLabel>
        <Input id="session-name" className="h-11" value={name} onChange={(event) => setName(event.target.value)} />
        <FieldDescription>Two services with the same name on the same day aren’t allowed.</FieldDescription>
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field>
          <FieldLabel htmlFor="session-date">Date</FieldLabel>
          <Input
            id="session-date"
            type="date"
            className="h-11"
            value={date}
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

      <Field>
        <FieldLabel htmlFor="session-type">Kind of gathering</FieldLabel>
        <NativeSelect
          className="h-11 w-full"
          id="session-type"
          value={type}
          onChange={(event) => setType(event.target.value as ServiceType)}
        >
          {SERVICE_TYPES.map((option) => (
            <NativeSelectOption key={option} value={option}>
              {SERVICE_TYPE_LABELS[option]}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Field>

      <Field>
        <FieldLabel htmlFor="session-notes">Notes (optional)</FieldLabel>
        <Textarea id="session-notes" rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />
      </Field>
    </AdaptiveDialog>
  );
}

interface CsvImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (csv: string) => void;
}

/**
 * Imports an attendance list. Rows that do not match anybody are reported
 * rather than guessed at, and no new people are created.
 */
export function CsvImportDialog({ open, onOpenChange, onConfirm }: CsvImportDialogProps) {
  const [csv, setCsv] = useState("name,phone\n");

  return (
    <AdaptiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Import a list"
      description={
        <>
          Paste a list with a <code>name</code> column and, if you have it, a <code>phone</code> column.
        </>
      }
      footer={
        <>
          <Button variant="ghost" size="lg" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="lg" className="flex-1" onClick={() => onConfirm(csv)}>
            Import
          </Button>
        </>
      }
    >
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
          We match people by phone number first, then by exact name. Nobody new is created; rows we
          can’t match are listed so you can check them.
        </FieldDescription>
      </Field>
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
      <Field>
        <FieldLabel htmlFor="correction-session">Which service were they at?</FieldLabel>
        <NativeSelect
          className="h-11 w-full"
          id="correction-session"
          value={target}
          onChange={(event) => setTarget(event.target.value)}
        >
          {sessions.map((session) => (
            <NativeSelectOption key={session.id} value={session.id}>
              {session.id === currentSessionId ? "This one (or none)" : `${session.name} · ${formatDisplayDate(session.date)}`}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <FieldDescription>
          {moving ? "Their check-in moves to the service you picked." : "Pick another service to move them, or leave this to remove the check-in."}
        </FieldDescription>
      </Field>

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
