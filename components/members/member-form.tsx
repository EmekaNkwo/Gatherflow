"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDownIcon } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SelectField, type SelectOption } from "@/components/shared/select-field";
import { ConsentChoice } from "@/components/people/responsive-dialog";
import { DuplicateSuggestions } from "@/components/visitors/duplicate-suggestions";
import { personHref } from "@/components/shared/person-cell";
import { MEMBER_FIELD_LIMITS } from "./field-limits";
import { toIsoDate } from "@/lib/dates";
import { CONTACT_METHODS, CONTACT_METHOD_LABELS, type ContactMethod } from "@/types/common";
import { useMembers } from "@/hooks/useMembers";
import { useNow } from "@/hooks/use-now";
import { useSnapshot } from "@/hooks/use-church-data";
import { useVisitors } from "@/hooks/useVisitors";

const CONTACT_METHOD_OPTIONS: SelectOption[] = CONTACT_METHODS.map((method) => ({
  value: method,
  label: CONTACT_METHOD_LABELS[method],
}));

/**
 * Adds a member directly: name, how to reach them and their consent first,
 * the rest under "More details".
 *
 * Someone who already has a visitor record should be made a member from that
 * record instead, so their history carries over — the "Have we met them
 * before?" suggestions point that out before a second record is created.
 *
 * Lives in the "Add a member" modal, which passes `onDone` (close, then go to
 * the new record) and `onCancel`.
 */
interface MemberFormProps {
  /** Called before going to the new or matched record. */
  onDone?: () => void;
  /** Replaces the default Cancel, which goes back a page. */
  onCancel?: () => void;
}

export function MemberForm({ onDone, onCancel }: MemberFormProps = {}) {
  const router = useRouter();
  const now = useNow();
  const snapshot = useSnapshot();
  const { register } = useMembers();
  const { findDuplicates } = useVisitors();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [preferredName, setPreferredName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [membershipDate, setMembershipDate] = useState(toIsoDate(now));
  const [preferredService, setPreferredService] = useState("sunday_service");
  const [householdId, setHouseholdId] = useState("");
  const [preferredMethod, setPreferredMethod] = useState<ContactMethod>("phone");
  // Consent is asked of each person, never assumed: unticked until they say yes.
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [more, setMore] = useState(false);
  // Visible in-flight state: the button is disabled and Enter is ignored
  // until the first request answers, so a double tap adds one person.
  const [submitting, setSubmitting] = useState(false);
  // The ref closes the gap between two taps landing before React re-renders.
  const inFlight = useRef(false);
  const canSubmit = Boolean(firstName.trim() && lastName.trim()) && !submitting;

  const duplicates =
    firstName.trim().length > 1 || phone.length > 5 ? findDuplicates({ firstName, lastName, phone, email }) : [];

  const submit = async () => {
    if (!canSubmit || inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    try {
      const outcome = await register({
        firstName,
        lastName,
        preferredName: preferredName || undefined,
        phone: phone || undefined,
        email: email || undefined,
        membershipDate,
        preferredServiceType: preferredService,
        householdId: householdId || undefined,
        preferredMethod,
        permissionGranted,
      });
      if (outcome.ok) go(`/members/${outcome.value.personId}`);
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };

  /** "That's them": a member opens their member page, a visitor their visitor page. */
  const openExisting = (personId: string) => {
    const match = snapshot.people.find((person) => person.id === personId);
    if (match) go(personHref(match));
  };

  const go = (href: string) => {
    onDone?.();
    router.push(href);
  };

  return (
    <form
      className="space-y-6"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <DuplicateSuggestions matches={duplicates} onUseExisting={openExisting} />

      <FieldGroup className="gap-4 sm:grid sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="member-first">First name</FieldLabel>
          <Input
            id="member-first"
            className="h-12 text-base"
            autoComplete="given-name"
            maxLength={MEMBER_FIELD_LIMITS.name}
            value={firstName}
            onChange={(event) => setFirstName(event.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="member-last">Last name</FieldLabel>
          <Input
            id="member-last"
            className="h-12 text-base"
            autoComplete="family-name"
            maxLength={MEMBER_FIELD_LIMITS.name}
            value={lastName}
            onChange={(event) => setLastName(event.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="member-phone">Phone number</FieldLabel>
          <Input
            id="member-phone"
            className="h-12 text-base"
            inputMode="tel"
            autoComplete="tel"
            maxLength={MEMBER_FIELD_LIMITS.phone}
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="member-email">Email (optional)</FieldLabel>
          <Input
            id="member-email"
            className="h-12 text-base"
            type="email"
            autoComplete="email"
            maxLength={MEMBER_FIELD_LIMITS.email}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>
      </FieldGroup>

      <div className="space-y-4">
        <ConsentChoice id="member-permission" title="Happy for us to get in touch" hint="Only tick this if they said yes.">
          <Checkbox
            id="member-permission"
            className="size-5"
            checked={permissionGranted}
            onCheckedChange={(checked) => setPermissionGranted(checked === true)}
          />
        </ConsentChoice>
        {permissionGranted ? (
          <SelectField
            className="sm:max-w-xs"
            id="member-method"
            label="Best way to reach them"
            value={preferredMethod}
            onValueChange={(value) => setPreferredMethod(value as ContactMethod)}
            options={CONTACT_METHOD_OPTIONS}
          />
        ) : null}
      </div>

      <div>
        <button
          type="button"
          aria-expanded={more}
          onClick={() => setMore((open) => !open)}
          className="flex min-h-11 items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          More details
          <ChevronDownIcon className={cn("size-4 transition-transform", more && "rotate-180")} />
        </button>
        {more ? (
          <FieldGroup className="mt-3 gap-4 sm:grid sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="member-preferred">What they like to be called</FieldLabel>
              <Input
                id="member-preferred"
                className="h-11"
                maxLength={MEMBER_FIELD_LIMITS.preferredName}
                value={preferredName}
                onChange={(event) => setPreferredName(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="member-date">Member since</FieldLabel>
              <Input
                id="member-date"
                type="date"
                className="h-11"
                value={membershipDate}
                onChange={(event) => setMembershipDate(event.target.value)}
              />
            </Field>
            <SelectField
              id="member-service"
              label="Service they usually come to"
              value={preferredService}
              onValueChange={setPreferredService}
              options={snapshot.settings.services.map((service) => ({ value: service.type, label: service.name }))}
            />
            <SelectField
              id="member-household"
              label="Household"
              value={householdId}
              onValueChange={setHouseholdId}
              options={[
                { value: "", label: "No household" },
                ...snapshot.households.map((household) => ({ value: household.id, label: household.name })),
              ]}
            />
            <p className="text-sm text-muted-foreground sm:col-span-2">
              Emergency contacts are kept separately on their record, and only people allowed to see pastoral care
              can see them.
            </p>
          </FieldGroup>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="submit"
          size="lg"
          className="h-12 flex-1 rounded-full text-base sm:flex-none sm:px-8"
          disabled={!canSubmit}
          aria-busy={submitting}
        >
          {submitting ? "Adding…" : `Add ${firstName.trim() || "member"}`}
        </Button>
        <Button type="button" variant="ghost" size="lg" className="rounded-full" onClick={() => (onCancel ? onCancel() : router.back())}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
