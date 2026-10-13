"use client";

import { useState } from "react";
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
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { SERVICE_TYPES, SERVICE_TYPE_LABELS, type ServiceType } from "@/types/attendance";
import type { CreateSessionInput } from "@/services/attendance/sessions";

interface CreateSessionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  today: string;
  onConfirm: (input: CreateSessionInput) => void;
}

/** Creates a service, event or meeting that attendance can be recorded against. */
export function CreateSessionDialog({
  open,
  onOpenChange,
  today,
  onConfirm,
}: CreateSessionDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New service or event</DialogTitle>
          <DialogDescription>
            A session with the same name on the same day is refused, so attendance is not split
            across duplicates.
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <SessionFields today={today} onCancel={() => onOpenChange(false)} onConfirm={onConfirm} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function SessionFields({
  today,
  onCancel,
  onConfirm,
}: {
  today: string;
  onCancel: () => void;
  onConfirm: (input: CreateSessionInput) => void;
}) {
  const [name, setName] = useState("Sunday service");
  const [date, setDate] = useState(today);
  const [startTime, setStartTime] = useState("10:00");
  const [type, setType] = useState<ServiceType>("sunday_service");
  const [notes, setNotes] = useState("");

  return (
    <>
      <Field>
        <FieldLabel htmlFor="session-name">Name</FieldLabel>
        <Input id="session-name" value={name} onChange={(event) => setName(event.target.value)} />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="session-date">Date</FieldLabel>
          <Input
            id="session-date"
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="session-time">Start time</FieldLabel>
          <Input
            id="session-time"
            type="time"
            value={startTime}
            onChange={(event) => setStartTime(event.target.value)}
          />
        </Field>
      </div>

      <Field>
        <FieldLabel htmlFor="session-type">Type</FieldLabel>
        <NativeSelect
          className="w-full"
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
        <Textarea
          id="session-notes"
          rows={2}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
      </Field>

      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          disabled={!name.trim() || !date}
          onClick={() =>
            onConfirm({ name, date, startTime, type, notes: notes.trim() || undefined })
          }
        >
          Create session
        </Button>
      </DialogFooter>
    </>
  );
}

interface CsvImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (csv: string) => void;
}

/**
 * Imports a mock attendance CSV. Rows that do not match anybody are
 * reported rather than guessed at, and no new people are created.
 */
export function CsvImportDialog({ open, onOpenChange, onConfirm }: CsvImportDialogProps) {
  const [csv, setCsv] = useState("name,phone\n");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import attendance</DialogTitle>
          <DialogDescription>
            Paste a CSV with a <code>name</code> column and an optional <code>phone</code> column.
          </DialogDescription>
        </DialogHeader>

        <Field>
          <FieldLabel htmlFor="csv-body">CSV</FieldLabel>
          <Textarea
            id="csv-body"
            rows={8}
            value={csv}
            onChange={(event) => setCsv(event.target.value)}
            className="font-mono text-xs"
          />
          <FieldDescription>
            People are matched by phone number first, then by exact name. Nothing is created for
            rows that do not match — they are listed so you can check them.
          </FieldDescription>
        </Field>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => onConfirm(csv)}>Import</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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

/** Corrects an attendance record, keeping the history of what changed. */
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Correct attendance for {personName}</DialogTitle>
          <DialogDescription>
            The record is kept either way — corrections are recorded, not erased.
          </DialogDescription>
        </DialogHeader>

        <Field>
          <FieldLabel htmlFor="correction-reason">Reason</FieldLabel>
          <Input
            id="correction-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Checked in by mistake"
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="correction-session">Move to another session</FieldLabel>
          <NativeSelect
            className="w-full"
            id="correction-session"
            value={target}
            onChange={(event) => setTarget(event.target.value)}
          >
            {sessions.map((session) => (
              <NativeSelectOption key={session.id} value={session.id}>
                {session.name} · {session.date}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="outline"
            disabled={target === currentSessionId}
            onClick={() => onMove(target, reason.trim() || undefined)}
          >
            Move record
          </Button>
          <Button variant="destructive" onClick={() => onRemove(reason.trim() || undefined)}>
            Remove record
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
