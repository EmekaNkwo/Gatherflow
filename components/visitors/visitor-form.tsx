"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ChevronDownIcon } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { ConsentChoice } from "@/components/people/responsive-dialog";
import { formatDisplayDate, toIsoDate } from "@/lib/dates";
import { CONTACT_METHODS, CONTACT_METHOD_LABELS } from "@/types/common";
import { VISITOR_SOURCES, VISITOR_SOURCE_LABELS } from "@/types/person";
import { INTEREST_POOL } from "@/data/seed/names";
import { visitorRegistrationSchema, type VisitorRegistrationValues } from "@/services/visitors/schema";
import { useRole } from "@/hooks/useRole";
import { useNow } from "@/hooks/use-now";
import { useSnapshot } from "@/hooks/use-church-data";
import { useVisitors } from "@/hooks/useVisitors";
import { DuplicateSuggestions } from "./duplicate-suggestions";

/** Fields that live under "More details"; an error in one opens it. */
const DETAIL_FIELDS = ["preferredName", "source", "assignedTo", "interests", "notes"] as const;

/**
 * Adding a visitor with time to spare.
 *
 * Name, how to reach them and their consent come first; everything else is
 * under "More details". The component only renders and collects: validation
 * comes from the shared schema and the record is created by the visitor
 * service through the hook.
 */
export function VisitorForm() {
  const router = useRouter();
  const now = useNow();
  const snapshot = useSnapshot();
  const { assignableTeam } = useRole();
  const { register: registerVisitor, findDuplicates, recordAnotherVisit } = useVisitors();
  const [more, setMore] = useState(false);

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
      // Consent is asked of each person, never assumed: unticked until they say yes.
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
  const errors = form.formState.errors;
  const chosenSession = recentSessions.find((session) => session.id === watched.sessionId);

  const duplicates = useMemo(
    () =>
      firstName.trim().length > 1 || lastName.trim().length > 1 || (phone ?? "").length > 5
        ? findDuplicates({ firstName, lastName, phone, email })
        : [],
    [findDuplicates, firstName, lastName, phone, email],
  );

  const detailsOpen = more || DETAIL_FIELDS.some((field) => Boolean(errors[field]));
  const visitOpen = Boolean(errors.visitDate);

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
      <details open={visitOpen || undefined} className="group rounded-2xl bg-muted px-4 py-3">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3">
          <span>
            {chosenSession ? (
              <>
                Came to <strong>{chosenSession.name}</strong>, {formatDisplayDate(chosenSession.date)}
              </>
            ) : (
              <>Visited on {formatDisplayDate(watched.visitDate)}, not checked in to a service</>
            )}
          </span>
          <span className="text-sm font-medium text-primary">Change</span>
        </summary>
        <FieldGroup className="mt-3 gap-4 sm:grid sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="sessionId">Service</FieldLabel>
            <NativeSelect className="w-full" id="sessionId" {...form.register("sessionId")}>
              <NativeSelectOption value="">Don&apos;t check them in</NativeSelectOption>
              {recentSessions.map((session) => (
                <NativeSelectOption key={session.id} value={session.id}>
                  {session.name} · {formatDisplayDate(session.date)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <FieldDescription>Choosing a service checks them in, so visit counts stay real.</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="visitDate">Date they came</FieldLabel>
            <Input id="visitDate" type="date" className="h-11" {...form.register("visitDate")} />
            <FieldError errors={[errors.visitDate]} />
          </Field>
        </FieldGroup>
      </details>

      <DuplicateSuggestions matches={duplicates} onUseExisting={useExisting} />

      <FieldGroup className="gap-4 sm:grid sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="firstName">First name</FieldLabel>
          <Input id="firstName" className="h-12 text-base" autoComplete="given-name" {...form.register("firstName")} />
          <FieldError errors={[errors.firstName]} />
        </Field>
        <Field>
          <FieldLabel htmlFor="lastName">Last name</FieldLabel>
          <Input id="lastName" className="h-12 text-base" autoComplete="family-name" {...form.register("lastName")} />
          <FieldError errors={[errors.lastName]} />
        </Field>
        <Field>
          <FieldLabel htmlFor="phone">Phone number</FieldLabel>
          <Input
            id="phone"
            className="h-12 text-base"
            inputMode="tel"
            autoComplete="tel"
            {...form.register("phone")}
          />
          <FieldError errors={[errors.phone]} />
        </Field>
        <Field>
          <FieldLabel htmlFor="email">Email (optional)</FieldLabel>
          <Input
            id="email"
            className="h-12 text-base"
            type="email"
            autoComplete="email"
            {...form.register("email")}
          />
          <FieldError errors={[errors.email]} />
        </Field>
      </FieldGroup>

      <div className="space-y-4">
        <ConsentChoice
          id="permissionGranted"
          title="Happy for us to get in touch"
          hint="Only tick this if they said yes. Without it, nobody will message them, but we still keep their visit."
        >
          <Checkbox
            id="permissionGranted"
            className="size-5"
            checked={watched.permissionGranted}
            onCheckedChange={(checked) => form.setValue("permissionGranted", checked === true)}
          />
        </ConsentChoice>
        {/* How to reach them only matters once they've said yes. */}
        {watched.permissionGranted ? (
          <Field className="sm:max-w-xs">
            <FieldLabel htmlFor="preferredMethod">Best way to reach them</FieldLabel>
            <NativeSelect className="w-full" id="preferredMethod" {...form.register("preferredMethod")}>
              {CONTACT_METHODS.map((method) => (
                <NativeSelectOption key={method} value={method}>
                  {CONTACT_METHOD_LABELS[method]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <FieldError errors={[errors.preferredMethod]} />
          </Field>
        ) : null}
      </div>

      <div>
        <button
          type="button"
          aria-expanded={detailsOpen}
          onClick={() => setMore((open) => !open)}
          className="flex min-h-11 items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          More details
          <ChevronDownIcon className={cn("size-4 transition-transform", detailsOpen && "rotate-180")} />
        </button>
        {detailsOpen ? (
          <div className="mt-3 space-y-5">
            <FieldGroup className="gap-4 sm:grid sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="preferredName">What they like to be called</FieldLabel>
                <Input id="preferredName" className="h-11" {...form.register("preferredName")} />
              </Field>
              <Field>
                <FieldLabel htmlFor="source">How they found us</FieldLabel>
                <NativeSelect className="w-full" id="source" {...form.register("source")}>
                  {VISITOR_SOURCES.map((source) => (
                    <NativeSelectOption key={source} value={source}>
                      {VISITOR_SOURCE_LABELS[source]}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel htmlFor="assignedTo">Who will say hello</FieldLabel>
                <NativeSelect className="w-full" id="assignedTo" {...form.register("assignedTo")}>
                  <NativeSelectOption value="">Let the coordinator decide</NativeSelectOption>
                  {assignableTeam.map((member) => (
                    <NativeSelectOption key={member.id} value={member.id}>
                      {member.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
            </FieldGroup>

            <label
              htmlFor="returningVisitor"
              className="flex min-h-11 cursor-pointer items-center gap-3"
            >
              <Checkbox
                id="returningVisitor"
                className="size-5"
                checked={watched.returningVisitor}
                onCheckedChange={(checked) => form.setValue("returningVisitor", checked === true)}
              />
              They&apos;ve been before
            </label>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">What they&apos;re interested in (optional)</legend>
              <div className="flex flex-wrap gap-2">
                {INTEREST_POOL.map((interest) => {
                  const checked = interests.includes(interest);
                  return (
                    <label
                      key={interest}
                      className="flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-4 text-sm has-data-checked:border-primary has-data-checked:bg-accent"
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
            </fieldset>

            <Field>
              <FieldLabel htmlFor="notes">Notes for whoever says hello (optional)</FieldLabel>
              <Textarea id="notes" rows={3} {...form.register("notes")} />
              <FieldDescription>
                Practical things only. Private pastoral detail belongs in Pastoral care.
              </FieldDescription>
              <FieldError errors={[errors.notes]} />
            </Field>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="submit"
          size="lg"
          className="h-12 flex-1 rounded-full text-base sm:flex-none sm:px-8"
          disabled={form.formState.isSubmitting}
        >
          Add {firstName.trim() || "visitor"}
        </Button>
        <Button type="button" variant="ghost" size="lg" className="rounded-full" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
