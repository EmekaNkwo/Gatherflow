"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm, useWatch } from "react-hook-form";
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
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { toIsoDate } from "@/lib/dates";
import { CONTACT_METHODS, CONTACT_METHOD_LABELS } from "@/types/common";
import { VISITOR_SOURCES, VISITOR_SOURCE_LABELS } from "@/types/person";
import {
  quickRegistrationSchema,
  type QuickRegistrationValues,
} from "@/services/visitors/schema";
import { useRole } from "@/hooks/useRole";
import { useNow } from "@/hooks/use-now";
import { useVisitors } from "@/hooks/useVisitors";
import { DuplicateSuggestions } from "./duplicate-suggestions";

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
  const { assignableTeam } = useRole();
  const { register: registerVisitor, findDuplicates } = useVisitors();
  const [registered, setRegistered] = useState<Registered[]>([]);
  const [details, setDetails] = useState(false);

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

  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await registerVisitor({
      firstName: values.firstName,
      lastName: values.lastName,
      phone: values.phone || undefined,
      visitDate: toIsoDate(now),
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
            <Input id="quick-firstName" className="h-12 text-base" autoFocus autoComplete="off" {...form.register("firstName")} />
            <FieldError errors={[errors.firstName]} />
          </Field>
          <Field>
            <FieldLabel htmlFor="quick-lastName">Last name</FieldLabel>
            <Input id="quick-lastName" className="h-12 text-base" autoComplete="off" {...form.register("lastName")} />
            <FieldError errors={[errors.lastName]} />
          </Field>
          <Field className="sm:col-span-2">
            <FieldLabel htmlFor="quick-phone">Phone number</FieldLabel>
            <Input id="quick-phone" className="h-12 text-base" inputMode="tel" autoComplete="off" {...form.register("phone")} />
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
              <Field>
                <FieldLabel htmlFor="quick-source">How they found us</FieldLabel>
                <NativeSelect className="w-full" id="quick-source" {...form.register("source")}>
                  {VISITOR_SOURCES.map((source) => (
                    <NativeSelectOption key={source} value={source}>
                      {VISITOR_SOURCE_LABELS[source]}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel htmlFor="quick-method">Best way to reach them</FieldLabel>
                <NativeSelect className="w-full" id="quick-method" {...form.register("preferredMethod")}>
                  {CONTACT_METHODS.map((method) => (
                    <NativeSelectOption key={method} value={method}>
                      {CONTACT_METHOD_LABELS[method]}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel htmlFor="quick-assignee">Who will say hello</FieldLabel>
                <NativeSelect className="w-full" id="quick-assignee" {...form.register("assignedTo")}>
                  <NativeSelectOption value="">Let the coordinator decide</NativeSelectOption>
                  {assignableTeam.map((member) => (
                    <NativeSelectOption key={member.id} value={member.id}>
                      {member.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
            </FieldGroup>
          ) : null}
        </div>

        <Button type="submit" size="lg" className="h-12 w-full rounded-full text-base sm:w-auto sm:px-8">
          Add {firstName.trim() || "them"}
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
