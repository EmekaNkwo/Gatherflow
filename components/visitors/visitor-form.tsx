"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ShieldCheckIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { toIsoDate } from "@/lib/dates";
import { CONTACT_METHODS, CONTACT_METHOD_LABELS } from "@/types/common";
import { VISITOR_SOURCES, VISITOR_SOURCE_LABELS } from "@/types/person";
import { INTEREST_POOL } from "@/data/seed/names";
import {
  visitorRegistrationSchema,
  type VisitorRegistrationValues,
} from "@/services/visitors/schema";
import { useDemoRole } from "@/hooks/useDemoRole";
import { useNow } from "@/hooks/use-now";
import { useSnapshot } from "@/hooks/use-church-data";
import { useVisitors } from "@/hooks/useVisitors";
import { DuplicateSuggestions } from "./duplicate-suggestions";

/**
 * Full visitor registration.
 *
 * The component only renders and collects: validation comes from the shared
 * schema and the record is created by the visitor service through the hook.
 */
export function VisitorForm() {
  const router = useRouter();
  const now = useNow();
  const snapshot = useSnapshot();
  const { assignableTeam } = useDemoRole();
  const { register: registerVisitor, findDuplicates, recordAnotherVisit } = useVisitors();

  const recentSessions = useMemo(
    () =>
      [...snapshot.sessions]
        .filter((session) => session.date <= toIsoDate(now))
        .sort((left, right) => (left.date < right.date ? 1 : -1))
        .slice(0, 8),
    [snapshot.sessions, now],
  );

  const form = useForm<VisitorRegistrationValues>({
    resolver: zodResolver(visitorRegistrationSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      preferredName: "",
      phone: "",
      email: "",
      visitDate: toIsoDate(now),
      sessionId: recentSessions[0]?.id ?? "",
      source: "invitation",
      assignedTo: "",
      preferredMethod: "whatsapp",
      permissionGranted: false,
      interests: [],
      notes: "",
      returningVisitor: false,
    },
  });

  // `useWatch` rather than `form.watch`, so the values are subscribed to
  // properly and the component stays compiler-friendly.
  const watched = useWatch({ control: form.control });
  const firstName = watched.firstName ?? "";
  const lastName = watched.lastName ?? "";
  const phone = watched.phone;
  const email = watched.email;
  const interests = watched.interests ?? [];

  const duplicates = useMemo(
    () =>
      firstName.trim().length > 1 || lastName.trim().length > 1 || (phone ?? "").length > 5
        ? findDuplicates({ firstName, lastName, phone, email })
        : [],
    [findDuplicates, firstName, lastName, phone, email],
  );

  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await registerVisitor({
      firstName: values.firstName,
      lastName: values.lastName,
      preferredName: values.preferredName || undefined,
      phone: values.phone || undefined,
      email: values.email || undefined,
      visitDate: values.visitDate,
      sessionId: values.sessionId || undefined,
      source: values.source,
      assignedTo: values.assignedTo || undefined,
      preferredMethod: values.preferredMethod,
      permissionGranted: values.permissionGranted,
      interests: values.interests ?? [],
      notes: values.notes || undefined,
      returningVisitor: values.returningVisitor ?? false,
    });

    if (outcome.ok) {
      router.push(`/visitors/${outcome.value.personId}`);
    }
  });

  const useExisting = async (personId: string) => {
    const sessionId = form.getValues("sessionId");
    if (!sessionId) {
      router.push(`/visitors/${personId}`);
      return;
    }
    const outcome = await recordAnotherVisit(personId, sessionId);
    if (outcome.ok) router.push(`/visitors/${personId}`);
  };

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <DuplicateSuggestions matches={duplicates} onUseExisting={useExisting} />

      <FieldSet>
        <FieldLegend>Who visited?</FieldLegend>
        <FieldGroup className="sm:grid sm:grid-cols-2 sm:gap-4">
          <Field>
            <FieldLabel htmlFor="firstName">First name</FieldLabel>
            <Input id="firstName" autoComplete="given-name" {...form.register("firstName")} />
            <FieldError errors={[form.formState.errors.firstName]} />
          </Field>
          <Field>
            <FieldLabel htmlFor="lastName">Last name</FieldLabel>
            <Input id="lastName" autoComplete="family-name" {...form.register("lastName")} />
            <FieldError errors={[form.formState.errors.lastName]} />
          </Field>
          <Field>
            <FieldLabel htmlFor="preferredName">Preferred name</FieldLabel>
            <Input id="preferredName" {...form.register("preferredName")} />
            <FieldDescription>What they would like to be called.</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="phone">Phone number</FieldLabel>
            <Input id="phone" inputMode="tel" autoComplete="tel" {...form.register("phone")} />
            <FieldError errors={[form.formState.errors.phone]} />
          </Field>
          <Field>
            <FieldLabel htmlFor="email">Email (optional)</FieldLabel>
            <Input id="email" type="email" autoComplete="email" {...form.register("email")} />
            <FieldError errors={[form.formState.errors.email]} />
          </Field>
        </FieldGroup>
      </FieldSet>

      <FieldSet>
        <FieldLegend>About the visit</FieldLegend>
        <FieldGroup className="sm:grid sm:grid-cols-2 sm:gap-4">
          <Field>
            <FieldLabel htmlFor="visitDate">Date of visit</FieldLabel>
            <Input id="visitDate" type="date" {...form.register("visitDate")} />
            <FieldError errors={[form.formState.errors.visitDate]} />
          </Field>
          <Field>
            <FieldLabel htmlFor="sessionId">Service attended</FieldLabel>
            <NativeSelect className="w-full" id="sessionId" {...form.register("sessionId")}>
              <NativeSelectOption value="">Not recorded</NativeSelectOption>
              {recentSessions.map((session) => (
                <NativeSelectOption key={session.id} value={session.id}>
                  {session.name} · {session.date}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <FieldDescription>
              Choosing a service records their attendance, so visit counts stay real.
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="source">How did they hear about us?</FieldLabel>
            <NativeSelect className="w-full" id="source" {...form.register("source")}>
              {VISITOR_SOURCES.map((source) => (
                <NativeSelectOption key={source} value={source}>
                  {VISITOR_SOURCE_LABELS[source]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor="assignedTo">Assign follow-up to</FieldLabel>
            <NativeSelect className="w-full" id="assignedTo" {...form.register("assignedTo")}>
              <NativeSelectOption value="">Leave for the coordinator</NativeSelectOption>
              {assignableTeam.map((member) => (
                <NativeSelectOption key={member.id} value={member.id}>
                  {member.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <FieldDescription>
              Unassigned visitors appear in &ldquo;awaiting assignment&rdquo; on the dashboard.
            </FieldDescription>
          </Field>
        </FieldGroup>
        <Field orientation="horizontal">
          <Checkbox
            id="returningVisitor"
            checked={watched.returningVisitor}
            onCheckedChange={(checked) =>
              form.setValue("returningVisitor", checked === true)
            }
          />
          <FieldLabel htmlFor="returningVisitor" className="font-normal">
            They have visited before
          </FieldLabel>
        </Field>
      </FieldSet>

      <FieldSet>
        <FieldLegend>Keeping in touch</FieldLegend>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="preferredMethod">Preferred contact method</FieldLabel>
            <NativeSelect
              className="w-full sm:w-64"
              id="preferredMethod"
              {...form.register("preferredMethod")}
            >
              {CONTACT_METHODS.map((method) => (
                <NativeSelectOption key={method} value={method}>
                  {CONTACT_METHOD_LABELS[method]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <FieldError errors={[form.formState.errors.preferredMethod]} />
          </Field>

          <Field orientation="horizontal">
            <Checkbox
              id="permissionGranted"
              checked={watched.permissionGranted}
              onCheckedChange={(checked) =>
                form.setValue("permissionGranted", checked === true)
              }
            />
            <div>
              <FieldLabel htmlFor="permissionGranted" className="font-normal">
                They are happy for us to get in touch
              </FieldLabel>
              <FieldDescription className="flex gap-1.5">
                <ShieldCheckIcon className="mt-0.5 size-3.5 shrink-0" />
                Without this, no messages are drafted and no contact tasks are created. The record
                is still kept so nobody asks them twice.
              </FieldDescription>
            </div>
          </Field>

          <Field>
            <FieldLabel>Interests (optional)</FieldLabel>
            <div className="flex flex-wrap gap-2">
              {INTEREST_POOL.map((interest) => {
                const checked = interests.includes(interest);
                return (
                  <label
                    key={interest}
                    className="flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm has-data-checked:border-primary has-data-checked:bg-muted/50"
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(value) =>
                        form.setValue(
                          "interests",
                          value === true
                            ? [...interests, interest]
                            : interests.filter((entry) => entry !== interest),
                        )
                      }
                    />
                    {interest}
                  </label>
                );
              })}
            </div>
          </Field>

          <Field>
            <FieldLabel htmlFor="notes">Follow-up notes (optional)</FieldLabel>
            <Textarea id="notes" rows={3} {...form.register("notes")} />
            <FieldDescription>
              Practical notes only. Sensitive pastoral detail belongs in the pastoral-care
              section, where access is restricted.
            </FieldDescription>
            <FieldError errors={[form.formState.errors.notes]} />
          </Field>
        </FieldGroup>
      </FieldSet>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={form.formState.isSubmitting}>
          Register visitor
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
