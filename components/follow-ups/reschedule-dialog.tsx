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
import { addDaysIso } from "@/lib/dates";
import type { TaskWithPerson } from "@/services/follow-ups/selectors";

interface RescheduleDialogProps {
  task: TaskWithPerson | null;
  today: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: (dueDate: string, reason?: string) => void;
}

/** Moves a due date without closing the task, and records why. */
export function RescheduleDialog({
  task,
  today,
  onOpenChange,
  onConfirm,
}: RescheduleDialogProps) {
  return (
    <Dialog open={Boolean(task)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reschedule {task?.task.reference}</DialogTitle>
          <DialogDescription>
            The task stays open and the change is recorded on the timeline.
          </DialogDescription>
        </DialogHeader>

        {/* Keyed on the task so each one opens with fresh values, rather
            than needing an effect to clear the last task's answers. */}
        <RescheduleFields
          key={task?.task.id ?? "none"}
          today={today}
          onCancel={() => onOpenChange(false)}
          onConfirm={onConfirm}
        />
      </DialogContent>
    </Dialog>
  );
}

function RescheduleFields({
  today,
  onCancel,
  onConfirm,
}: {
  today: string;
  onCancel: () => void;
  onConfirm: (dueDate: string, reason?: string) => void;
}) {
  const [dueDate, setDueDate] = useState(() => addDaysIso(today, 3));
  const [reason, setReason] = useState("");

  return (
    <>
        <Field>
          <FieldLabel htmlFor="reschedule-date">New due date</FieldLabel>
          <Input
            id="reschedule-date"
            type="date"
            value={dueDate}
            min={today}
            onChange={(event) => setDueDate(event.target.value)}
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="reschedule-reason">Reason (optional)</FieldLabel>
          <Input
            id="reschedule-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="They asked for an evening call"
          />
          <FieldDescription>
            Helpful for whoever picks this up next.
          </FieldDescription>
        </Field>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            onClick={() => onConfirm(dueDate, reason.trim() || undefined)}
            disabled={!dueDate}
          >
            Reschedule
          </Button>
        </DialogFooter>
    </>
  );
}
