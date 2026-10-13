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
import {
  MEMBERSHIP_STATUSES,
  MEMBERSHIP_STATUS_LABELS,
  type MembershipStatus,
} from "@/types/person";
import type { Group } from "@/types/group";

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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Membership status for {personName}</DialogTitle>
          <DialogDescription>
            Statuses never change on their own. Missing a few services is a prompt to check in,
            not a reason to reclassify someone.
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <StatusFields
            current={current}
            onCancel={() => onOpenChange(false)}
            onConfirm={onConfirm}
          />
        ) : null}
      </DialogContent>
    </Dialog>
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
      <Field>
        <FieldLabel htmlFor="status-value">New status</FieldLabel>
        <NativeSelect
          className="w-full"
          id="status-value"
          value={status}
          onChange={(event) => setStatus(event.target.value as MembershipStatus)}
        >
          {MEMBERSHIP_STATUSES.map((option) => (
            <NativeSelectOption key={option} value={option}>
              {MEMBERSHIP_STATUS_LABELS[option]}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Field>

      <Field>
        <FieldLabel htmlFor="status-reason">Reason</FieldLabel>
        <Input
          id="status-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Moved to another church"
        />
        <FieldDescription>Kept on the record so the change can be explained.</FieldDescription>
      </Field>

      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          disabled={status === current}
          onClick={() => onConfirm(status, reason.trim() || undefined)}
        >
          Save status
        </Button>
      </DialogFooter>
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
export function AddToGroupDialog({
  open,
  onOpenChange,
  personName,
  groups,
  onConfirm,
}: AddToGroupDialogProps) {
  const active = groups.filter((group) => group.active);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add {personName} to a group</DialogTitle>
          <DialogDescription>
            The assignment records who added them and when. Nobody is added automatically.
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <GroupFields
            groups={active}
            onCancel={() => onOpenChange(false)}
            onConfirm={onConfirm}
          />
        ) : null}
      </DialogContent>
    </Dialog>
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
      <Field>
        <FieldLabel htmlFor="group-id">Group</FieldLabel>
        <NativeSelect
          className="w-full"
          id="group-id"
          value={groupId}
          onChange={(event) => setGroupId(event.target.value)}
        >
          {groups.map((group) => (
            <NativeSelectOption key={group.id} value={group.id}>
              {group.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        {selected?.involvesMinors ? (
          <FieldDescription>
            This group works with under-18s. Membership details are only shown to roles authorised
            for it.
          </FieldDescription>
        ) : null}
      </Field>

      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button disabled={!groupId} onClick={() => onConfirm(groupId)}>
          Add to group
        </Button>
      </DialogFooter>
    </>
  );
}
