"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDownIcon } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { PageHeader, PageShell } from "@/components/shared/page-header";
import { RestrictedState } from "@/components/shared/empty-state";
import { ConsentChoice } from "@/components/people/responsive-dialog";
import { DuplicateSuggestions } from "@/components/visitors/duplicate-suggestions";
import { toIsoDate } from "@/lib/dates";
import { CONTACT_METHODS, CONTACT_METHOD_LABELS, type ContactMethod } from "@/types/common";
import { useRole } from "@/hooks/useRole";
import { useMembers } from "@/hooks/useMembers";
import { useNow } from "@/hooks/use-now";
import { useSnapshot } from "@/hooks/use-church-data";
import { useVisitors } from "@/hooks/useVisitors";

/**
 * Adds a member directly: name, how to reach them and their consent first,
 * the rest under "More details".
 *
 * Someone who already has a visitor record should be made a member from that
 * record instead, so their history carries over — the "Have we met them
 * before?" suggestions point that out before a second record is created.
 */
export default function NewMemberPage() {
  const router = useRouter();
  const now = useNow();
  const snapshot = useSnapshot();
  const { can } = useRole();
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

  if (!can("people.write")) {
    return (
      <PageShell>
        <RestrictedState section="Member registration" />
      </PageShell>
    );
  }

  const duplicates =
    firstName.trim().length > 1 || phone.length > 5 ? findDuplicates({ firstName, lastName, phone, email }) : [];

  const submit = async () => {
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
    if (outcome.ok) router.push(`/members/${outcome.value.personId}`);
  };

  return (
    <PageShell className="max-w-2xl">
      <PageHeader
        title="Add a member"
        description="For someone joining directly. If they've visited before, make them a member from their visitor page so their story carries over."
      />

      <form
        className="space-y-6"
        onSubmit={(event) => {
          event.preventDefault();
          if (firstName.trim() && lastName.trim()) void submit();
        }}
      >
        <DuplicateSuggestions matches={duplicates} onUseExisting={(personId) => router.push(`/visitors/${personId}`)} />

        <FieldGroup className="gap-4 sm:grid sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="member-first">First name</FieldLabel>
            <Input
              id="member-first"
              className="h-12 text-base"
              autoComplete="given-name"
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
            <Field className="sm:max-w-xs">
              <FieldLabel htmlFor="member-method">Best way to reach them</FieldLabel>
              <NativeSelect
                className="w-full"
                id="member-method"
                value={preferredMethod}
                onChange={(event) => setPreferredMethod(event.target.value as ContactMethod)}
              >
                {CONTACT_METHODS.map((method) => (
                  <NativeSelectOption key={method} value={method}>
                    {CONTACT_METHOD_LABELS[method]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
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
              <Field>
                <FieldLabel htmlFor="member-service">Service they usually come to</FieldLabel>
                <NativeSelect
                  className="w-full"
                  id="member-service"
                  value={preferredService}
                  onChange={(event) => setPreferredService(event.target.value)}
                >
                  {snapshot.settings.services.map((service) => (
                    <NativeSelectOption key={service.id} value={service.type}>
                      {service.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel htmlFor="member-household">Household</FieldLabel>
                <NativeSelect
                  className="w-full"
                  id="member-household"
                  value={householdId}
                  onChange={(event) => setHouseholdId(event.target.value)}
                >
                  <NativeSelectOption value="">No household</NativeSelectOption>
                  {snapshot.households.map((household) => (
                    <NativeSelectOption key={household.id} value={household.id}>
                      {household.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
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
            disabled={!firstName.trim() || !lastName.trim()}
          >
            Add {firstName.trim() || "member"}
          </Button>
          <Button type="button" variant="ghost" size="lg" className="rounded-full" onClick={() => router.back()}>
            Cancel
          </Button>
        </div>
      </form>
    </PageShell>
  );
}
