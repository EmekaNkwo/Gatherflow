"use client";

import { useState } from "react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/shared/select-field";
import { DialogActions, DialogBody, ResponsiveDialog } from "@/components/people/responsive-dialog";
import {
  MEMBERSHIP_STATUSES,
  MEMBERSHIP_STATUS_LABELS,
  type MembershipStatus,
} from "@/types/person";
import type { Group } from "@/types/group";
import { MEMBER_FIELD_LIMITS } from "./field-limits";

interface StatusDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  personName: string;
  current: MembershipStatus;
  onConfirm: (status: MembershipStatus, reason: string | undefined) => void;
}

/**
 * Membership status changes always carry a reason, so any report that lists
 * someone can explain why they are in it.
 */
export function MembershipStatusDialog({
  open,
  onOpenChange,
  personName,
  current,
  onConfirm,
}: StatusDialogProps) {
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Change ${personName.split(" ")[0]}'s membership`}
      description="This never changes on its own. Missing a few Sundays is a reason to check in, not to change it."
    >
      {open ? <StatusFields current={current} onCancel={() => onOpenChange(false)} onConfirm={onConfirm} /> : null}
    </ResponsiveDialog>
  );
}

function StatusFields({
  current,
  onCancel,
  onConfirm,
}: {
  current: MembershipStatus;
  onCancel: () => void;
  onConfirm: (status: MembershipStatus, reason: string | undefined) => void;
}) {
  const [status, setStatus] = useState<MembershipStatus>(current);
  const [reason, setReason] = useState("");

  return (
    <>
      <DialogBody>
        <fieldset className="space-y-2">
          <legend className="sr-only">New status</legend>
          {MEMBERSHIP_STATUSES.map((option) => (
            <label
              key={option}
              className={cn(
                "flex min-h-12 cursor-pointer items-center gap-3 rounded-2xl border-2 px-4 font-medium transition-colors",
                status === option ? "border-primary bg-accent" : "border-border hover:bg-muted",
              )}
            >
              <input
                type="radio"
                name="membership-status"
                value={option}
                checked={status === option}
                onChange={() => setStatus(option)}
                className="size-5 accent-[var(--primary)]"
              />
              {MEMBERSHIP_STATUS_LABELS[option]}
              {option === current ? (
                <span className="ml-auto text-sm font-normal text-muted-foreground">Now</span>
              ) : null}
            </label>
          ))}
        </fieldset>

        <Field>
          <FieldLabel htmlFor="status-reason">Why</FieldLabel>
          <Input
            id="status-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={MEMBER_FIELD_LIMITS.reason}
            placeholder="Moved to another church"
          />
          <FieldDescription>Kept on their record so the change can be explained.</FieldDescription>
        </Field>
      </DialogBody>
      <DialogActions>
        <Button variant="ghost" size="lg" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="lg"
          className="flex-1"
          disabled={status === current}
          onClick={() => onConfirm(status, reason.trim() || undefined)}
        >
          Save
        </Button>
      </DialogActions>
    </>
  );
}

interface AddToGroupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  personName: string;
  groups: readonly Group[];
  onConfirm: (groupId: string) => void;
}

/** Group membership is always an explicit, recorded decision. */
export function AddToGroupDialog({ open, onOpenChange, personName, groups, onConfirm }: AddToGroupDialogProps) {
  const active = groups.filter((group) => group.active);

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Add ${personName.split(" ")[0]} to a group`}
      description="We'll note who added them and when. Nobody is added automatically."
    >
      {open ? <GroupFields groups={active} onCancel={() => onOpenChange(false)} onConfirm={onConfirm} /> : null}
    </ResponsiveDialog>
  );
}

function GroupFields({
  groups,
  onCancel,
  onConfirm,
}: {
  groups: readonly Group[];
  onCancel: () => void;
  onConfirm: (groupId: string) => void;
}) {
  const [groupId, setGroupId] = useState(groups[0]?.id ?? "");
  const selected = groups.find((group) => group.id === groupId);

  return (
    <>
      <DialogBody>
        <SelectField
          id="group-id"
          label="Group"
          description={
            selected?.involvesMinors
              ? "This group works with under-18s, so who is in it is only shown to people allowed to see it."
              : undefined
          }
          value={groupId}
          onValueChange={setGroupId}
          options={groups.map((group) => ({ value: group.id, label: group.name }))}
        />
      </DialogBody>
      <DialogActions>
        <Button variant="ghost" size="lg" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="lg" className="flex-1" disabled={!groupId} onClick={() => onConfirm(groupId)}>
          Add to group
        </Button>
      </DialogActions>
    </>
  );
}
