"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { PageHeader, PageShell } from "@/components/shared/page-header";
import { RestrictedState } from "@/components/shared/empty-state";
import { DuplicateSuggestions } from "@/components/visitors/duplicate-suggestions";
import { toIsoDate } from "@/lib/dates";
import { CONTACT_METHODS, CONTACT_METHOD_LABELS, type ContactMethod } from "@/types/common";
import { useDemoRole } from "@/hooks/useDemoRole";
import { useMembers } from "@/hooks/useMembers";
import { useNow } from "@/hooks/use-now";
import { useSnapshot } from "@/hooks/use-church-data";
import { useVisitors } from "@/hooks/useVisitors";

/**
 * Registers a member directly.
 *
 * Someone who already has a visitor record should be confirmed from that
 * record instead, so their history carries over — the duplicate suggestions
 * point that out before a second record is created.
 */
export default function NewMemberPage() {
  const router = useRouter();
  const now = useNow();
  const snapshot = useSnapshot();
  const { can } = useDemoRole();
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
  const [permissionGranted, setPermissionGranted] = useState(true);

  if (!can("people.write")) {
    return (
      <PageShell>
        <RestrictedState section="Member registration" />
      </PageShell>
    );
  }

  const duplicates =
    firstName.trim().length > 1 || phone.length > 5
      ? findDuplicates({ firstName, lastName, phone, email })
      : [];

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
    <PageShell className="max-w-3xl">
      <PageHeader
        title="Add a member"
        description="For someone joining directly. If they have visited before, open their visitor record and confirm membership there so their history carries over."
      />

      <Card>
        <CardContent className="space-y-6">
          <DuplicateSuggestions
            matches={duplicates}
            onUseExisting={(personId) => router.push(`/visitors/${personId}`)}
          />

          <FieldGroup className="sm:grid sm:grid-cols-2 sm:gap-4">
            <Field>
              <FieldLabel htmlFor="member-first">First name</FieldLabel>
              <Input
                id="member-first"
                value={firstName}
                onChange={(event) => setFirstName(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="member-last">Last name</FieldLabel>
              <Input
                id="member-last"
                value={lastName}
                onChange={(event) => setLastName(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="member-preferred">Preferred name</FieldLabel>
              <Input
                id="member-preferred"
                value={preferredName}
                onChange={(event) => setPreferredName(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="member-phone">Phone</FieldLabel>
              <Input
                id="member-phone"
                inputMode="tel"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="member-email">Email</FieldLabel>
              <Input
                id="member-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="member-date">Membership date</FieldLabel>
              <Input
                id="member-date"
                type="date"
                value={membershipDate}
                onChange={(event) => setMembershipDate(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="member-service">Preferred service</FieldLabel>
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
            <Field>
              <FieldLabel htmlFor="member-method">Preferred contact</FieldLabel>
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
          </FieldGroup>

          <Field orientation="horizontal">
            <Checkbox
              id="member-permission"
              checked={permissionGranted}
              onCheckedChange={(checked) => setPermissionGranted(checked === true)}
            />
            <div>
              <FieldLabel htmlFor="member-permission" className="font-normal">
                Happy to be contacted by the church
              </FieldLabel>
              <FieldDescription>
                Emergency contacts are added separately on the member&apos;s record and are
                restricted.
              </FieldDescription>
            </div>
          </Field>

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void submit()} disabled={!firstName.trim() || !lastName.trim()}>
              Register member
            </Button>
            <Button variant="outline" onClick={() => router.back()}>
              Cancel
            </Button>
          </div>
        </CardContent>
      </Card>
    </PageShell>
  );
}
