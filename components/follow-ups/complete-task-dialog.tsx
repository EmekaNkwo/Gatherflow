"use client";

import { useState } from "react";
import { InfoIcon } from "lucide-react";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { displayName } from "@/lib/strings";
import {
  FOLLOW_UP_TASK_TYPE_LABELS,
  TASK_OUTCOMES,
  TASK_OUTCOME_LABELS,
  type TaskOutcome,
} from "@/types/follow-up";
import type { TaskWithPerson } from "@/services/follow-ups/selectors";

/** What each outcome will do next — stated before the volunteer commits. */
const CONSEQUENCES: Record<TaskOutcome, string> = {
  contacted: "Records the contact, moves the visitor along and suggests the next step.",
  no_answer: "Records an attempt and schedules another try, unless the agreed limit is reached.",
  requested_another_time:
    "Records the attempt and schedules a call back at the time they asked for.",
  not_interested: "Stops follow-up and cancels any other open tasks for this person.",
  wrong_details: "Records the attempt and asks you to check the contact details.",
  needs_another_team: "Closes this follow-up as referred to another team.",
  other: "Records the completion with your note and creates nothing further.",
};

interface CompleteTaskDialogProps {
  task: TaskWithPerson | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (outcome: TaskOutcome, note?: string) => void;
}

/**
 * Completing a follow-up always records an outcome: what happened decides
 * what the church does next, so it is never a bare "done" tick.
 */
export function CompleteTaskDialog({ task, onOpenChange, onConfirm }: CompleteTaskDialogProps) {
  return (
    <Dialog open={Boolean(task)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Record the outcome</DialogTitle>
          <DialogDescription>
            {task
              ? `${task.task.reference} · ${FOLLOW_UP_TASK_TYPE_LABELS[task.task.type]}${
                  task.person ? ` for ${displayName(task.person)}` : ""
                }`
              : null}
          </DialogDescription>
        </DialogHeader>

        {/* Keyed on the task, so each task starts from a clean form rather
            than needing an effect to reset the previous answers. */}
        {task ? (
          <OutcomeForm
            key={task.task.id}
            onCancel={() => onOpenChange(false)}
            onConfirm={onConfirm}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function OutcomeForm({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: (outcome: TaskOutcome, note?: string) => void;
}) {
  const [outcome, setOutcome] = useState<TaskOutcome>("contacted");
  const [note, setNote] = useState("");

  return (
    <>
      <Field>
        <FieldLabel>What happened?</FieldLabel>
        <RadioGroup
          value={outcome}
          onValueChange={(value) => setOutcome(value as TaskOutcome)}
          className="gap-1"
        >
          {TASK_OUTCOMES.map((option) => (
            <label
              key={option}
              className="flex cursor-pointer items-start gap-2.5 rounded-lg border p-2.5 text-sm has-data-checked:border-primary has-data-checked:bg-muted/50"
            >
              <RadioGroupItem value={option} className="mt-0.5" />
              <span className="space-y-0.5">
                <span className="block font-medium">{TASK_OUTCOME_LABELS[option]}</span>
                <span className="block text-xs text-muted-foreground">
                  {CONSEQUENCES[option]}
                </span>
              </span>
            </label>
          ))}
        </RadioGroup>
      </Field>

      <Field>
        <FieldLabel htmlFor="outcome-note">Note (optional)</FieldLabel>
        <Textarea
          id="outcome-note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Anything the next person should know."
          rows={3}
        />
        <FieldDescription className="flex gap-1.5">
          <InfoIcon className="mt-0.5 size-3.5 shrink-0" />
          Notes here appear on the person&apos;s timeline. Keep sensitive pastoral detail in the
          pastoral-care section instead.
        </FieldDescription>
      </Field>

      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={() => onConfirm(outcome, note.trim() || undefined)}>Save outcome</Button>
      </DialogFooter>
    </>
  );
}
