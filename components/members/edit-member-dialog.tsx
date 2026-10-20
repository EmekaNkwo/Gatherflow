"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/shared/select-field";
import { DialogActions, DialogBody, ResponsiveDialog } from "@/components/people/responsive-dialog";
import { MEMBER_FIELD_LIMITS } from "./field-limits";
import type { PersonCorrection } from "@/services/people/people";
import type { Household, Person } from "@/types/person";

interface EditMemberDialogProps {
  person: Person | null;
  households: readonly Household[];
  onOpenChange: (open: boolean) => void;
  /** Sends `person.correct`; resolves true when the server accepted it. */
  onSave: (changes: PersonCorrection) => Promise<boolean>;
}

/**
 * "Edit details": correct a member's name, how to reach them and their
 * household, in the same modal shape as "Add a member" (a sheet on a phone).
 * Only the fields that actually changed are sent, so the timeline names
 * exactly what was corrected.
 */
export function EditMemberDialog({ person, households, onOpenChange, onSave }: EditMemberDialogProps) {
  return (
    <ResponsiveDialog
      open={person !== null}
      onOpenChange={onOpenChange}
      title="Edit their details"
      description="Fix a name, a phone number or which household they belong to. The change is noted on their timeline."
      className="sm:max-w-xl"
    >
      {person ? (
        <EditFields
          key={person.id}
          person={person}
          households={households}
          onCancel={() => onOpenChange(false)}
          onSave={onSave}
        />
      ) : null}
    </ResponsiveDialog>
  );
}

interface Draft {
  firstName: string;
  lastName: string;
  preferredName: string;
  phone: string;
  email: string;
  householdId: string;
}

function draftFrom(person: Person): Draft {
  return {
    firstName: person.firstName,
    lastName: person.lastName,
    preferredName: person.preferredName ?? "",
    phone: person.phone ?? "",
    email: person.email ?? "",
    householdId: person.householdId ?? "",
  };
}

/** The changes between the record and the draft, as `person.correct` expects them. */
export function changesBetween(person: Person, draft: Draft): PersonCorrection {
  const before = draftFrom(person);
  const text = (key: Exclude<keyof Draft, "householdId">) =>
    draft[key].trim() !== before[key].trim() ? { [key]: draft[key].trim() } : {};
  return {
    ...text("firstName"),
    ...text("lastName"),
    ...text("preferredName"),
    ...text("phone"),
    ...text("email"),
    ...(draft.householdId !== before.householdId ? { householdId: draft.householdId || null } : {}),
  };
}

function EditFields({
  person,
  households,
  onCancel,
  onSave,
}: {
  person: Person;
  households: readonly Household[];
  onCancel: () => void;
  onSave: (changes: PersonCorrection) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<Draft>(() => draftFrom(person));
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);

  const changes = changesBetween(person, draft);
  const missingName = !draft.firstName.trim() || !draft.lastName.trim();
  const canSave = Object.keys(changes).length > 0 && !missingName && !saving;

  const set = (key: keyof Draft) => (value: string) => setDraft((current) => ({ ...current, [key]: value }));

  const save = async () => {
    if (!canSave || inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    try {
      if (await onSave(changes)) onCancel();
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <DialogBody>
        <FieldGroup className="gap-4 sm:grid sm:grid-cols-2">
          <TextField id="edit-first" label="First name" value={draft.firstName} onChange={set("firstName")} maxLength={MEMBER_FIELD_LIMITS.name} autoComplete="given-name" />
          <TextField id="edit-last" label="Last name" value={draft.lastName} onChange={set("lastName")} maxLength={MEMBER_FIELD_LIMITS.name} autoComplete="family-name" />
          <TextField id="edit-preferred" label="What they like to be called" value={draft.preferredName} onChange={set("preferredName")} maxLength={MEMBER_FIELD_LIMITS.preferredName} />
          <TextField id="edit-phone" label="Phone number" value={draft.phone} onChange={set("phone")} maxLength={MEMBER_FIELD_LIMITS.phone} inputMode="tel" autoComplete="tel" />
          <TextField id="edit-email" label="Email" value={draft.email} onChange={set("email")} maxLength={MEMBER_FIELD_LIMITS.email} type="email" autoComplete="email" />
          <SelectField
            id="edit-household"
            label="Household"
            value={draft.householdId}
            onValueChange={set("householdId")}
            options={[
              { value: "", label: "No household" },
              ...households.map((household) => ({ value: household.id, label: household.name })),
            ]}
          />
        </FieldGroup>
        {missingName ? <p className="text-sm text-destructive">A first and last name are both needed.</p> : null}
      </DialogBody>
      <DialogActions>
        <Button type="button" variant="ghost" size="lg" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="lg" className="flex-1" disabled={!canSave} aria-busy={saving}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </DialogActions>
    </form>
  );
}

function TextField({
  id,
  label,
  value,
  onChange,
  ...input
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  maxLength: number;
  type?: string;
  inputMode?: "tel";
  autoComplete?: string;
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input id={id} className="h-12 text-base" value={value} onChange={(event) => onChange(event.target.value)} {...input} />
    </Field>
  );
}
