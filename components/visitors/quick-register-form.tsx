"use client";

import { type BaseSyntheticEvent, useRef, useState } from "react";
import Link from "next/link";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2Icon, ChevronDownIcon } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/shared/select-field";
import { toIsoDate } from "@/lib/dates";
import { CONTACT_METHODS, CONTACT_METHOD_LABELS } from "@/types/common";
import { VISITOR_SOURCES, VISITOR_SOURCE_LABELS } from "@/types/person";
import {
  quickRegistrationSchema,
  VISITOR_FIELD_LIMITS,
  type QuickRegistrationValues,
} from "@/services/visitors/schema";
import { useSnapshot } from "@/hooks/use-church-data";
import { useRole } from "@/hooks/useRole";
import { useNow } from "@/hooks/use-now";
import { useVisitors } from "@/hooks/useVisitors";
import { DuplicateSuggestions } from "./duplicate-suggestions";

const VISITOR_SOURCE_OPTIONS = VISITOR_SOURCES.map((source) => ({
  value: source,
  label: VISITOR_SOURCE_LABELS[source],
}));

const CONTACT_METHOD_OPTIONS = CONTACT_METHODS.map((method) => ({
  value: method,
  label: CONTACT_METHOD_LABELS[method],
}));

interface Registered {
  id: string;
  name: string;
}

/**
 * Welcoming somebody new: a name, a number and their consent, with the rest
 * behind "More details". It resets itself for the next person, keeps the
 * choices made under "More details", and lists who has been added. Enter in
 * any field saves.
 */
export function QuickRegisterForm({ sessionId }: { sessionId?: string }) {
  const now = useNow();
  const { assignableTeam, can, currentMember } = useRole();
  const sessions = useSnapshot().sessions;
  const { register: registerVisitor, findDuplicates } = useVisitors();
  const [registered, setRegistered] = useState<Registered[]>([]);
  const [details, setDetails] = useState(false);
  // A synchronous lock: a double tap or two quick Enters arrive before any
  // re-render, so a state flag alone would let both through.
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);

  // Somebody who can't hand out follow-ups may only take one on themselves.
  const helpers = can("tasks.assign")
    ? assignableTeam
    : assignableTeam.filter((member) => member.id === currentMember?.id);

  const form = useForm<QuickRegistrationValues>({
    resolver: zodResolver(quickRegistrationSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      phone: "",
      source: "walk_in",
      preferredMethod: "whatsapp",
      // Consent is asked of each person, never assumed: unticked until they say yes.
      permissionGranted: false,
      assignedTo: "",
    },
  });

  const watched = useWatch({ control: form.control });
  const firstName = watched.firstName ?? "";
  const lastName = watched.lastName ?? "";
  const phone = watched.phone;

  const duplicates =
    firstName.trim().length > 1 || (phone ?? "").length > 5
      ? findDuplicates({ firstName, lastName, phone })
      : [];

  const save = form.handleSubmit(async (values) => {
    // The service decides the date of the visit; today only without one.
    const sessionDate = sessionId ? sessions.find((entry) => entry.id === sessionId)?.date : undefined;
    const outcome = await registerVisitor({
      firstName: values.firstName,
      lastName: values.lastName,
      phone: values.phone || undefined,
      visitDate: sessionDate ?? toIsoDate(now),
      sessionId,
      source: values.source,
      assignedTo: values.assignedTo || undefined,
      preferredMethod: values.preferredMethod,
      permissionGranted: values.permissionGranted,
    });

    if (!outcome.ok) return;

    setRegistered((previous) => [
      {
        id: outcome.value.personId,
        name: `${values.firstName} ${values.lastName}`.trim(),
      },
      ...previous,
    ]);

    // Keep where they came from and who follows up; clear the person, and
    // their consent with them, so the next one is asked afresh.
    form.reset({
      ...values,
      firstName: "",
      lastName: "",
      phone: "",
      permissionGranted: false,
    });
    // React Hook Form owns the inputs, so it also moves the focus back to
    // the first field — no manual ref needed.
    form.setFocus("firstName");
  });

  const onSubmit = async (event?: BaseSyntheticEvent) => {
    event?.preventDefault();
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    try {
      await save();
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };

  const errors = form.formState.errors;

  return (
    <div className="space-y-8">
      <form
        onSubmit={onSubmit}
        onKeyDown={(event) => {
          // Enter submits from any field; the form resets ready for the next person.
          if (event.key === "Enter" && event.target instanceof HTMLInputElement) {
            event.preventDefault();
            void onSubmit();
          }
        }}
        className="space-y-5"
      >
        <DuplicateSuggestions matches={duplicates} />

        <FieldGroup className="gap-4 sm:grid sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="quick-firstName">First name</FieldLabel>
            <Input id="quick-firstName" className="h-12 text-base" autoFocus autoComplete="off" maxLength={VISITOR_FIELD_LIMITS.name} {...form.register("firstName")} />
            <FieldError errors={[errors.firstName]} />
          </Field>
          <Field>
            <FieldLabel htmlFor="quick-lastName">Last name</FieldLabel>
            <Input id="quick-lastName" className="h-12 text-base" autoComplete="off" maxLength={VISITOR_FIELD_LIMITS.name} {...form.register("lastName")} />
            <FieldError errors={[errors.lastName]} />
          </Field>
          <Field className="sm:col-span-2">
            <FieldLabel htmlFor="quick-phone">Phone number</FieldLabel>
            <Input id="quick-phone" className="h-12 text-base" inputMode="tel" autoComplete="off" maxLength={VISITOR_FIELD_LIMITS.phone} {...form.register("phone")} />
            <FieldDescription>Optional, but it&apos;s how somebody can say hello this week.</FieldDescription>
            <FieldError errors={[errors.phone]} />
          </Field>
        </FieldGroup>

        <label
          htmlFor="quick-permission"
          className="flex min-h-14 cursor-pointer items-center gap-3 rounded-2xl border-2 px-4 has-data-checked:border-done has-data-checked:bg-done/8"
        >
          <Checkbox
            id="quick-permission"
            className="size-5"
            checked={watched.permissionGranted}
            onCheckedChange={(checked) => form.setValue("permissionGranted", checked === true)}
          />
          <span>
            <span className="block font-medium">Happy for us to get in touch</span>
            <span className="block text-sm text-muted-foreground">Only tick this if they said yes.</span>
          </span>
        </label>

        <div>
          <button
            type="button"
            aria-expanded={details}
            onClick={() => setDetails((open) => !open)}
            className="flex min-h-11 items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            More details
            <ChevronDownIcon className={cn("size-4 transition-transform", details && "rotate-180")} />
          </button>
          {details ? (
            <FieldGroup className="mt-2 gap-4 sm:grid sm:grid-cols-3">
              <Controller
                control={form.control}
                name="source"
                render={({ field, fieldState }) => (
                  <SelectField
                    id="quick-source"
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
                name="preferredMethod"
                render={({ field, fieldState }) => (
                  <SelectField
                    id="quick-method"
                    label="Best way to reach them"
                    value={field.value ?? ""}
                    onValueChange={field.onChange}
                    error={fieldState.error?.message}
                    options={CONTACT_METHOD_OPTIONS}
                  />
                )}
              />
              <Controller
                control={form.control}
                name="assignedTo"
                render={({ field, fieldState }) => (
                  <SelectField
                    id="quick-assignee"
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
          ) : null}
        </div>

        <Button
          type="submit"
          size="lg"
          disabled={busy}
          aria-busy={busy}
          className="h-12 w-full rounded-full text-base sm:w-auto sm:px-8"
        >
          {busy ? "Adding…" : `Add ${firstName.trim() || "them"}`}
        </Button>
      </form>

      {registered.length ? (
        <section className="space-y-3">
          <h2 className="text-xl font-medium">Added just now</h2>
          <p className="text-sm text-muted-foreground">
            Somebody will be asked to say hello to each of them.
          </p>
          <ul className="divide-y overflow-hidden rounded-3xl border bg-card">
            {registered.map((entry) => (
              <li key={entry.id}>
                <Link
                  href={`/visitors/${entry.id}`}
                  className="flex min-h-14 items-center gap-3 px-5 hover:bg-muted/50"
                >
                  <CheckCircle2Icon className="size-5 text-done" />
                  <span className="font-medium">{entry.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
