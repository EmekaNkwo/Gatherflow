"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { DialogActions, DialogBody, ResponsiveDialog } from "@/components/people/responsive-dialog";
import { displayName } from "@/lib/strings";
import { FOLLOW_UP_TASK_TYPE_LABELS } from "@/types/follow-up";
import type { TaskWithPerson } from "@/services/follow-ups/selectors";

interface CancelTaskDialogProps {
  task: TaskWithPerson | null;
  onOpenChange: (open: boolean) => void;
  /** Resolves once the command has returned, so the button can show it is busy. */
  onConfirm: (reason?: string) => void | Promise<unknown>;
}

/**
 * Stopping one follow-up without an outcome. A destructive step, so it is
 * confirmed, says what it does, and takes an optional reason for the timeline.
 */
export function CancelTaskDialog({ task, onOpenChange, onConfirm }: CancelTaskDialogProps) {
  const firstName = task?.person ? displayName(task.person).split(" ")[0] : null;
  const what = task ? FOLLOW_UP_TASK_TYPE_LABELS[task.task.type].toLowerCase() : "follow-up";

  return (
    <ResponsiveDialog
      open={Boolean(task)}
      onOpenChange={onOpenChange}
      title="Stop this follow-up?"
      description={
        firstName
          ? `The ${what} for ${firstName} comes off everyone's list. Nothing is sent to them.`
          : `The ${what} comes off everyone's list.`
      }
    >
      <CancelFields key={task?.task.id ?? "none"} onCancel={() => onOpenChange(false)} onConfirm={onConfirm} />
    </ResponsiveDialog>
  );
}

function CancelFields({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: (reason?: string) => void | Promise<unknown>;
}) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  return (
    <>
      <DialogBody>
        <Field>
          <FieldLabel htmlFor="cancel-reason">Why (optional)</FieldLabel>
          <Input
            id="cancel-reason"
            className="h-11"
            value={reason}
            maxLength={500}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Already spoke to them on Sunday"
          />
          <FieldDescription>Noted on their timeline.</FieldDescription>
        </Field>
      </DialogBody>
      <DialogActions>
        <Button variant="ghost" size="lg" onClick={onCancel}>
          Keep it
        </Button>
        <Button
          size="lg"
          variant="destructive"
          className="flex-1"
          disabled={saving}
          aria-busy={saving}
          onClick={async () => {
            if (saving) return;
            setSaving(true);
            try {
              await onConfirm(reason.trim() || undefined);
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving ? "Stopping…" : "Stop this follow-up"}
        </Button>
      </DialogActions>
    </>
  );
}
