"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { CONTACT_METHODS, CONTACT_METHOD_LABELS, type ContactMethod } from "@/types/common";
import { CLOSURE_REASON_LABELS, type ClosureReason } from "@/types/person";
import type { TeamMember } from "@/types/team";

/**
 * Visitor dialogs.
 *
 * Each one keeps its fields in a small child component keyed on what it is
 * editing, so opening the dialog again starts from clean values without an
 * effect that writes state during render.
 */

interface AssignDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  team: readonly TeamMember[];
  /** How many records the assignment will apply to. */
  count: number;
  onConfirm: (teamMemberId: string) => void;
}

export function AssignDialog({ open, onOpenChange, team, count, onConfirm }: AssignDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Assign follow-up</DialogTitle>
          <DialogDescription>
            {count === 1
              ? "One visitor will be assigned, and their open tasks move with them."
              : `${count} visitors will be assigned, and their open tasks move with them.`}
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <AssignFields
            team={team}
            onCancel={() => onOpenChange(false)}
            onConfirm={onConfirm}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function AssignFields({
  team,
  onCancel,
  onConfirm,
}: {
  team: readonly TeamMember[];
  onCancel: () => void;
  onConfirm: (teamMemberId: string) => void;
}) {
  const [assignee, setAssignee] = useState(team[0]?.id ?? "");

  return (
    <>
      <Field>
        <FieldLabel htmlFor="assignee">Follow-up person</FieldLabel>
        <NativeSelect
          className="w-full"
          id="assignee"
          value={assignee}
          onChange={(event) => setAssignee(event.target.value)}
        >
          {team.map((member) => (
            <NativeSelectOption key={member.id} value={member.id}>
              {member.name}
              {member.title ? ` · ${member.title}` : ""}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <FieldDescription>Only active team members can take new work.</FieldDescription>
      </Field>

      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button disabled={!assignee} onClick={() => onConfirm(assignee)}>
          Assign
        </Button>
      </DialogFooter>
    </>
  );
}

interface CloseFollowUpDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  personName: string;
  onConfirm: (reason: ClosureReason, note: string | undefined, optOut: boolean) => void;
}

/**
 * Stops follow-up for a visitor. Not every visitor should be pushed through
 * every stage, and this records why the record is closing.
 */
export function CloseFollowUpDialog({
  open,
  onOpenChange,
  personName,
  onConfirm,
}: CloseFollowUpDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Stop follow-up for {personName}</DialogTitle>
          <DialogDescription>
            Any open follow-up tasks are cancelled and no new ones are created automatically.
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <CloseFollowUpFields onCancel={() => onOpenChange(false)} onConfirm={onConfirm} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function CloseFollowUpFields({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: (reason: ClosureReason, note: string | undefined, optOut: boolean) => void;
}) {
  const [reason, setReason] = useState<ClosureReason>("paused");
  const [note, setNote] = useState("");
  const [optOut, setOptOut] = useState(false);

  return (
    <>
      <Field>
        <FieldLabel htmlFor="closure-reason">Outcome</FieldLabel>
        <NativeSelect
          className="w-full"
          id="closure-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value as ClosureReason)}
        >
          {(Object.keys(CLOSURE_REASON_LABELS) as ClosureReason[]).map((option) => (
            <NativeSelectOption key={option} value={option}>
              {CLOSURE_REASON_LABELS[option]}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Field>

      <Field>
        <FieldLabel htmlFor="closure-note">Note (optional)</FieldLabel>
        <Textarea
          id="closure-note"
          rows={3}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="What was agreed with them."
        />
      </Field>

      <Field orientation="horizontal">
        <Checkbox
          id="closure-opt-out"
          checked={optOut}
          onCheckedChange={(checked) => setOptOut(checked === true)}
        />
        <div>
          <FieldLabel htmlFor="closure-opt-out" className="font-normal">
            They asked not to be contacted again
          </FieldLabel>
          <FieldDescription>
            Records an opt-out. Messages can no longer be drafted for them, and the record stays
            so nobody asks again.
          </FieldDescription>
        </div>
      </Field>

      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="destructive"
          onClick={() => onConfirm(reason, note.trim() || undefined, optOut)}
        >
          Stop follow-up
        </Button>
      </DialogFooter>
    </>
  );
}

export interface ContactPreferenceValues {
  preferredMethod: ContactMethod;
  permissionGranted: boolean;
  optedOut: boolean;
}

interface ContactPreferencesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  personName: string;
  initial: ContactPreferenceValues;
  onConfirm: (changes: ContactPreferenceValues & { optOutReason?: string }) => void;
}

/** Records how — and whether — someone wants to be contacted. */
export function ContactPreferencesDialog({
  open,
  onOpenChange,
  personName,
  initial,
  onConfirm,
}: ContactPreferencesDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Contact preferences</DialogTitle>
          <DialogDescription>
            How {personName} would like to hear from the church.
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <ContactPreferenceFields
            initial={initial}
            onCancel={() => onOpenChange(false)}
            onConfirm={onConfirm}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ContactPreferenceFields({
  initial,
  onCancel,
  onConfirm,
}: {
  initial: ContactPreferenceValues;
  onCancel: () => void;
  onConfirm: (changes: ContactPreferenceValues & { optOutReason?: string }) => void;
}) {
  const [method, setMethod] = useState<ContactMethod>(initial.preferredMethod);
  const [permission, setPermission] = useState(initial.permissionGranted);
  const [optedOut, setOptedOut] = useState(initial.optedOut);
  const [reason, setReason] = useState("");

  return (
    <>
      <Field>
        <FieldLabel htmlFor="preference-method">Preferred method</FieldLabel>
        <NativeSelect
          className="w-full"
          id="preference-method"
          value={method}
          onChange={(event) => setMethod(event.target.value as ContactMethod)}
          disabled={optedOut}
        >
          {CONTACT_METHODS.map((option) => (
            <NativeSelectOption key={option} value={option}>
              {CONTACT_METHOD_LABELS[option]}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Field>

      <Field orientation="horizontal">
        <Checkbox
          id="preference-permission"
          checked={permission && !optedOut}
          disabled={optedOut}
          onCheckedChange={(checked) => setPermission(checked === true)}
        />
        <FieldLabel htmlFor="preference-permission" className="font-normal">
          Happy to be contacted about the church
        </FieldLabel>
      </Field>

      <Field orientation="horizontal">
        <Checkbox
          id="preference-opt-out"
          checked={optedOut}
          onCheckedChange={(checked) => setOptedOut(checked === true)}
        />
        <div>
          <FieldLabel htmlFor="preference-opt-out" className="font-normal">
            Asked not to be contacted again
          </FieldLabel>
          <FieldDescription>
            This always wins over any other preference. Open follow-up tasks are cancelled.
          </FieldDescription>
        </div>
      </Field>

      {optedOut ? (
        <Field>
          <FieldLabel htmlFor="preference-reason">Reason (optional)</FieldLabel>
          <Input
            id="preference-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
      ) : null}

      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          onClick={() =>
            onConfirm({
              preferredMethod: method,
              permissionGranted: permission,
              optedOut,
              optOutReason: reason.trim() || undefined,
            })
          }
        >
          Save preferences
        </Button>
      </DialogFooter>
    </>
  );
}
