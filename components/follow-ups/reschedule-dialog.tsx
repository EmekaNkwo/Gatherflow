"use client";

import { useState } from "react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { DialogActions, DialogBody, ResponsiveDialog } from "@/components/people/responsive-dialog";
import { addDaysIso } from "@/lib/dates";
import { displayName } from "@/lib/strings";
import type { TaskWithPerson } from "@/services/follow-ups/selectors";

interface RescheduleDialogProps {
  task: TaskWithPerson | null;
  today: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: (dueDate: string, reason?: string) => void;
}

/** The days people usually move a follow-up to, as big choices. */
const QUICK_DAYS = [
  { days: 1, label: "Tomorrow" },
  { days: 3, label: "In a few days" },
  { days: 7, label: "Next week" },
] as const;

/** Moves a due date without closing the follow-up, and notes why. */
export function RescheduleDialog({ task, today, onOpenChange, onConfirm }: RescheduleDialogProps) {
  const firstName = task?.person ? displayName(task.person).split(" ")[0] : null;

  return (
    <ResponsiveDialog
      open={Boolean(task)}
      onOpenChange={onOpenChange}
      title={firstName ? `When should we try ${firstName} again?` : "Move to another day"}
      description="It stays on the list, and the change is noted on their timeline."
    >
      {/* Keyed on the task so each one opens with fresh values, rather
          than needing an effect to clear the last task's answers. */}
      <RescheduleFields
        key={task?.task.id ?? "none"}
        today={today}
        onCancel={() => onOpenChange(false)}
        onConfirm={onConfirm}
      />
    </ResponsiveDialog>
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
      <DialogBody>
        <fieldset className="grid gap-2 sm:grid-cols-3">
          <legend className="sr-only">When</legend>
          {QUICK_DAYS.map((choice) => {
            const value = addDaysIso(today, choice.days);
            const selected = dueDate === value;
            return (
              <label
                key={choice.days}
                className={cn(
                  "flex min-h-12 cursor-pointer items-center gap-3 rounded-2xl border-2 px-4 font-medium transition-colors",
                  selected ? "border-primary bg-accent" : "border-border hover:bg-muted",
                )}
              >
                <input
                  type="radio"
                  name="reschedule-quick"
                  value={value}
                  checked={selected}
                  onChange={() => setDueDate(value)}
                  className="size-5 accent-[var(--primary)]"
                />
                {choice.label}
              </label>
            );
          })}
        </fieldset>

        <Field>
          <FieldLabel htmlFor="reschedule-date">Or pick a day</FieldLabel>
          <Input
            id="reschedule-date"
            type="date"
            className="h-11"
            value={dueDate}
            min={today}
            onChange={(event) => setDueDate(event.target.value)}
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="reschedule-reason">Why (optional)</FieldLabel>
          <Input
            id="reschedule-reason"
            className="h-11"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="They asked for an evening call"
          />
          <FieldDescription>Helpful for whoever picks this up next.</FieldDescription>
        </Field>
      </DialogBody>
      <DialogActions>
        <Button variant="ghost" size="lg" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="lg"
          className="flex-1"
          onClick={() => onConfirm(dueDate, reason.trim() || undefined)}
          disabled={!dueDate}
        >
          Move it
        </Button>
      </DialogActions>
    </>
  );
}
