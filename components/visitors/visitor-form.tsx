"use client";

import { type BaseSyntheticEvent, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ChevronDownIcon } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SelectField } from "@/components/shared/select-field";
import { ConsentChoice } from "@/components/people/responsive-dialog";
import { formatDisplayDate, toIsoDate } from "@/lib/dates";
import { CONTACT_METHODS, CONTACT_METHOD_LABELS } from "@/types/common";
import { VISITOR_SOURCES, VISITOR_SOURCE_LABELS } from "@/types/person";
import { INTEREST_POOL } from "@/data/seed/names";
import {
  VISITOR_FIELD_LIMITS,
  visitorRegistrationSchema,
  type VisitorRegistrationValues,
} from "@/services/visitors/schema";
import { useRole } from "@/hooks/useRole";
import { useNow } from "@/hooks/use-now";
import { useSnapshot } from "@/hooks/use-church-data";
import { useVisitors } from "@/hooks/useVisitors";
import { DuplicateSuggestions } from "./duplicate-suggestions";

/** Fields that live under "More details"; an error in one opens it. */
const DETAIL_FIELDS = ["preferredName", "source", "assignedTo", "interests", "notes"] as const;

const CONTACT_METHOD_OPTIONS = CONTACT_METHODS.map((method) => ({
  value: method,
  label: CONTACT_METHOD_LABELS[method],
}));

const VISITOR_SOURCE_OPTIONS = VISITOR_SOURCES.map((source) => ({
  value: source,
  label: VISITOR_SOURCE_LABELS[source],
}));

/**
 * Adding a visitor with time to spare.
 *
 * Name, how to reach them and their consent come first; everything else is
 * under "More details". The component only renders and collects: validation
 * comes from the shared schema and the record is created by the visitor
 * service through the hook.
 *
 * On its own page it navigates as a page does. Inside the welcome modal the
 * modal passes `onDone` (close, then go to the new record) and `onCancel`.
 */
interface VisitorFormProps {
  /** Check them in to this service, e.g. the one being checked in to. */
  defaultSessionId?: string;
  /** Called before going to the new or matched record. */
  onDone?: () => void;
  /** Replaces the default Cancel, which goes back a page. */
  onCancel?: () => void;
}

export function VisitorForm({ defaultSessionId, onDone, onCancel }: VisitorFormProps = {}) {
  const router = useRouter();
  const now = useNow();
  const snapshot = useSnapshot();
  const { assignableTeam, can, currentMember } = useRole();
  const { register: registerVisitor, findDuplicates, recordAnotherVisit } = useVisitors();
  const [more, setMore] = useState(false);
  // Synchronous lock against a double tap: both clicks arrive before a re-render.
  const saving = useRef(false);

  // Somebody who can't hand out follow-ups may only take one on themselves.
  const helpers = can("tasks.assign")
    ? assignableTeam
    : assignableTeam.filter((member) => member.id === currentMember?.id);

  const recentSessions = useMemo(() => {
    const recent = [...snapshot.sessions]
      .filter((session) => session.date <= toIsoDate(now))
      .sort((left, right) => (left.date < right.date ? 1 : -1))
      .slice(0, 8);
    // A service asked for by the caller is offered even when it is upcoming.
    const requested = snapshot.sessions.find((session) => session.id === defaultSessionId);
    return requested && !recent.some((session) => session.id === requested.id) ? [requested, ...recent] : recent;
  }, [snapshot.sessions, now, defaultSessionId]);

  const form = useForm<VisitorRegistrationValues>({
    resolver: zodResolver(visitorRegistrationSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      preferredName: "",
      phone: "",
      email: "",
      visitDate: toIsoDate(now),
      sessionId: defaultSessionId ?? recentSessions[0]?.id ?? "",
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

  const save = form.handleSubmit(async (values) => {
    // A chosen service decides the date of the visit; there is no second,
    // separate date that could disagree with it.
    const session = recentSessions.find((entry) => entry.id === values.sessionId);
    const outcome = await registerVisitor({
      firstName: values.firstName,
      lastName: values.lastName,
      preferredName: values.preferredName || undefined,
      phone: values.phone || undefined,
      email: values.email || undefined,
      visitDate: session?.date ?? values.visitDate,
      sessionId: session?.id,
      source: values.source,
      assignedTo: values.assignedTo || undefined,
      preferredMethod: values.preferredMethod,
      permissionGranted: values.permissionGranted,
      interests: values.interests ?? [],
      notes: values.notes || undefined,
      returningVisitor: values.returningVisitor ?? false,
    });

    if (outcome.ok) open(outcome.value.personId);
  });

  const onSubmit = async (event?: BaseSyntheticEvent) => {
    event?.preventDefault();
    if (saving.current) return;
    saving.current = true;
    try {
      await save();
    } finally {
      saving.current = false;
    }
  };

  const open = (personId: string) => {
    onDone?.();
    router.push(`/visitors/${personId}`);
  };

  const useExisting = async (personId: string) => {
    const sessionId = form.getValues("sessionId");
    if (!sessionId) {
      open(personId);
      return;
    }
    const outcome = await recordAnotherVisit(personId, sessionId);
    // Already checked in to this service: the visit is recorded, so go to them.
    if (outcome.ok || outcome.code === "duplicate") open(personId);
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
          <Controller
            control={form.control}
            name="sessionId"
            render={({ field, fieldState }) => (
              <SelectField
                id="sessionId"
                label="Service"
                description="Choosing a service checks them in, so visit counts stay real."
                value={field.value ?? ""}
                onValueChange={field.onChange}
                error={fieldState.error?.message}
                options={[
                  { value: "", label: "Don't check them in" },
                  ...recentSessions.map((session) => ({
                    value: session.id,
                    label: `${session.name} · ${formatDisplayDate(session.date)}`,
                  })),
                ]}
              />
            )}
          />
          {chosenSession ? null : (
            <Field>
              <FieldLabel htmlFor="visitDate">Date they came</FieldLabel>
              <Input id="visitDate" type="date" className="h-11" max={toIsoDate(now)} {...form.register("visitDate")} />
              <FieldError errors={[errors.visitDate]} />
            </Field>
          )}
        </FieldGroup>
      </details>

      <DuplicateSuggestions matches={duplicates} onUseExisting={useExisting} />

      <FieldGroup className="gap-4 sm:grid sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="firstName">First name</FieldLabel>
          <Input id="firstName" className="h-12 text-base" autoComplete="given-name" maxLength={VISITOR_FIELD_LIMITS.name} {...form.register("firstName")} />
          <FieldError errors={[errors.firstName]} />
        </Field>
        <Field>
          <FieldLabel htmlFor="lastName">Last name</FieldLabel>
          <Input id="lastName" className="h-12 text-base" autoComplete="family-name" maxLength={VISITOR_FIELD_LIMITS.name} {...form.register("lastName")} />
          <FieldError errors={[errors.lastName]} />
        </Field>
        <Field>
          <FieldLabel htmlFor="phone">Phone number</FieldLabel>
          <Input
            id="phone"
            className="h-12 text-base"
            inputMode="tel"
            autoComplete="tel"
            maxLength={VISITOR_FIELD_LIMITS.phone}
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
            maxLength={VISITOR_FIELD_LIMITS.email}
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
          <Controller
            control={form.control}
            name="preferredMethod"
            render={({ field, fieldState }) => (
              <SelectField
                id="preferredMethod"
                label="Best way to reach them"
                className="sm:max-w-xs"
                value={field.value ?? ""}
                onValueChange={field.onChange}
                error={fieldState.error?.message}
                options={CONTACT_METHOD_OPTIONS}
              />
            )}
          />
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
                <Input
                  id="preferredName"
                  className="h-11"
                  maxLength={VISITOR_FIELD_LIMITS.preferredName}
                  {...form.register("preferredName")}
                />
                <FieldError errors={[errors.preferredName]} />
              </Field>
              <Controller
                control={form.control}
                name="source"
                render={({ field, fieldState }) => (
                  <SelectField
                    id="source"
                    label="How they found us"
                    value={field.value ?? ""}
                    onValueChange={field.onChange}
                    error={fieldState.error?.message}
                    options={VISITOR_SOURCE_OPTIONS}
                  />
                )}
              />
              <Controller
                control={form.control}
                name="assignedTo"
                render={({ field, fieldState }) => (
                  <SelectField
                    id="assignedTo"
                    label="Who will say hello"
                    value={field.value ?? ""}
                    onValueChange={field.onChange}
                    error={fieldState.error?.message}
                    options={[
                      { value: "", label: "Let the coordinator decide" },
                      ...helpers.map((member) => ({
                        value: member.id,
                        label: member.id === currentMember?.id ? `Me (${member.name})` : member.name,
                      })),
                    ]}
                  />
                )}
              />
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
              <Textarea id="notes" rows={3} maxLength={VISITOR_FIELD_LIMITS.notes} {...form.register("notes")} />
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
          aria-busy={form.formState.isSubmitting}
        >
          {form.formState.isSubmitting ? "Adding…" : `Add ${firstName.trim() || "visitor"}`}
        </Button>
        <Button type="button" variant="ghost" size="lg" className="rounded-full" onClick={() => (onCancel ? onCancel() : router.back())}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
