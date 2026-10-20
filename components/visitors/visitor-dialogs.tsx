"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SelectField } from "@/components/shared/select-field";
import {
  ConsentChoice,
  DialogActions,
  DialogBody,
  ResponsiveDialog,
} from "@/components/people/responsive-dialog";
import { CONTACT_METHODS, CONTACT_METHOD_LABELS, type ContactMethod } from "@/types/common";
import { CLOSURE_REASON_LABELS, type ClosureReason } from "@/types/person";
import type { TeamMember } from "@/types/team";

const CLOSURE_REASON_OPTIONS = (Object.keys(CLOSURE_REASON_LABELS) as ClosureReason[]).map((option) => ({
  value: option,
  label: CLOSURE_REASON_LABELS[option],
}));

const CONTACT_METHOD_OPTIONS = CONTACT_METHODS.map((option) => ({
  value: option,
  label: CONTACT_METHOD_LABELS[option],
}));

/**
 * Visitor dialogs.
 *
 * Each one keeps its fields in a small child component keyed on what it is
 * editing, so opening the dialog again starts from clean values without an
 * effect that writes state during render. On a phone each is a sheet from
 * the bottom with its one main button in reach.
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
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Who will look after them?"
      description={
        count === 1
          ? "Anything still waiting for this person goes to them too."
          : `For ${count} people. Anything still waiting for them goes too.`
      }
    >
      {open ? (
        <AssignFields team={team} onCancel={() => onOpenChange(false)} onConfirm={onConfirm} />
      ) : null}
    </ResponsiveDialog>
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
      <DialogBody>
        <SelectField
          id="assignee"
          label="Person"
          description="Only people on the team today can take this on."
          value={assignee}
          onValueChange={setAssignee}
          options={team.map((member) => ({
            value: member.id,
            label: `${member.name}${member.title ? ` · ${member.title}` : ""}`,
          }))}
        />
      </DialogBody>
      <DialogActions>
        <Button variant="ghost" size="lg" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="lg" className="flex-1" disabled={!assignee} onClick={() => onConfirm(assignee)}>
          Give it to them
        </Button>
      </DialogActions>
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
 * every stage, and this records why.
 */
export function CloseFollowUpDialog({
  open,
  onOpenChange,
  personName,
  onConfirm,
}: CloseFollowUpDialogProps) {
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Stop following up ${personName.split(" ")[0]}?`}
      description="Anything still waiting for them is cancelled, and nothing new is set up."
    >
      {open ? <CloseFollowUpFields onCancel={() => onOpenChange(false)} onConfirm={onConfirm} /> : null}
    </ResponsiveDialog>
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
      <DialogBody>
        <SelectField
          id="closure-reason"
          label="Why"
          value={reason}
          onValueChange={(value) => setReason(value as ClosureReason)}
          options={CLOSURE_REASON_OPTIONS}
        />

        <Field>
          <FieldLabel htmlFor="closure-note">Note (optional)</FieldLabel>
          <Textarea
            id="closure-note"
            maxLength={500}
            rows={3}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="What was agreed with them."
          />
        </Field>

        <ConsentChoice
          id="closure-opt-out"
          title="They asked us not to contact them again"
          hint="We'll keep their record so nobody asks them twice, but no one can message them."
          className="has-data-checked:border-destructive has-data-checked:bg-destructive/8"
        >
          <Checkbox
            id="closure-opt-out"
            className="size-5"
            checked={optOut}
            onCheckedChange={(checked) => setOptOut(checked === true)}
          />
        </ConsentChoice>
      </DialogBody>
      <DialogActions>
        <Button variant="ghost" size="lg" onClick={onCancel}>
          Keep going
        </Button>
        <Button
          variant="destructive"
          size="lg"
          className="flex-1"
          onClick={() => onConfirm(reason, note.trim() || undefined, optOut)}
        >
          Stop follow-up
        </Button>
      </DialogActions>
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
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`How ${personName.split(" ")[0]} likes to hear from us`}
      description="Only change this when they've told you."
    >
      {open ? (
        <ContactPreferenceFields initial={initial} onCancel={() => onOpenChange(false)} onConfirm={onConfirm} />
      ) : null}
    </ResponsiveDialog>
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
      <DialogBody>
        <ConsentChoice
          id="preference-permission"
          title="Happy for us to get in touch"
          hint="Only tick this if they said yes."
          className={optedOut ? "pointer-events-none opacity-50" : undefined}
        >
          <Checkbox
            id="preference-permission"
            className="size-5"
            checked={permission && !optedOut}
            disabled={optedOut}
            onCheckedChange={(checked) => setPermission(checked === true)}
          />
        </ConsentChoice>

        <SelectField
          id="preference-method"
          label="Best way to reach them"
          value={method}
          onValueChange={(value) => setMethod(value as ContactMethod)}
          disabled={optedOut}
          options={CONTACT_METHOD_OPTIONS}
        />

        <ConsentChoice
          id="preference-opt-out"
          title="They asked us not to contact them again"
          hint="This always wins. Anything still waiting for them is cancelled."
          className="has-data-checked:border-destructive has-data-checked:bg-destructive/8"
        >
          <Checkbox
            id="preference-opt-out"
            className="size-5"
            checked={optedOut}
            onCheckedChange={(checked) => setOptedOut(checked === true)}
          />
        </ConsentChoice>

        {optedOut ? (
          <Field>
            <FieldLabel htmlFor="preference-reason">Why (optional)</FieldLabel>
            <Input
              id="preference-reason"
              value={reason}
              maxLength={500}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
        ) : null}
      </DialogBody>
      <DialogActions>
        <Button variant="ghost" size="lg" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="lg"
          className="flex-1"
          onClick={() =>
            onConfirm({
              preferredMethod: method,
              permissionGranted: permission,
              optedOut,
              optOutReason: reason.trim() || undefined,
            })
          }
        >
          Save
        </Button>
      </DialogActions>
    </>
  );
}
