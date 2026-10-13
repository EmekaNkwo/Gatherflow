"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2Icon, KeyboardIcon } from "lucide-react";
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
import { Kbd } from "@/components/ui/kbd";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Item, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item";
import { toIsoDate } from "@/lib/dates";
import { CONTACT_METHODS, CONTACT_METHOD_LABELS } from "@/types/common";
import { VISITOR_SOURCES, VISITOR_SOURCE_LABELS } from "@/types/person";
import {
  quickRegistrationSchema,
  type QuickRegistrationValues,
} from "@/services/visitors/schema";
import { useDemoRole } from "@/hooks/useDemoRole";
import { useNow } from "@/hooks/use-now";
import { useVisitors } from "@/hooks/useVisitors";
import { DuplicateSuggestions } from "./duplicate-suggestions";

interface Registered {
  id: string;
  name: string;
}

/**
 * Quick registration for a volunteer working through a queue after a
 * service: a short form, keyboard-friendly, that resets itself and keeps a
 * running list of who has been added.
 */
export function QuickRegisterForm({ sessionId }: { sessionId?: string }) {
  const now = useNow();
  const { assignableTeam } = useDemoRole();
  const { register: registerVisitor, findDuplicates } = useVisitors();
  const [registered, setRegistered] = useState<Registered[]>([]);

  const form = useForm<QuickRegistrationValues>({
    resolver: zodResolver(quickRegistrationSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      phone: "",
      source: "walk_in",
      preferredMethod: "whatsapp",
      permissionGranted: true,
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

    // Keep the source, assignment and consent choices; clear the identity
    // fields so the next person can be typed straight in.
    form.reset({
      ...values,
      firstName: "",
      lastName: "",
      phone: "",
    });
    // React Hook Form owns the inputs, so it also moves the focus back to
    // the first field — no manual ref needed.
    form.setFocus("firstName");
  });

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
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

        <FieldGroup className="sm:grid sm:grid-cols-2 sm:gap-4">
          <Field>
            <FieldLabel htmlFor="quick-firstName">First name</FieldLabel>
            <Input
              id="quick-firstName"
              autoFocus
              autoComplete="off"
              {...form.register("firstName")}
            />
            <FieldError errors={[form.formState.errors.firstName]} />
          </Field>
          <Field>
            <FieldLabel htmlFor="quick-lastName">Last name</FieldLabel>
            <Input id="quick-lastName" autoComplete="off" {...form.register("lastName")} />
            <FieldError errors={[form.formState.errors.lastName]} />
          </Field>
          <Field>
            <FieldLabel htmlFor="quick-phone">Phone (optional)</FieldLabel>
            <Input
              id="quick-phone"
              inputMode="tel"
              autoComplete="off"
              {...form.register("phone")}
            />
            <FieldError errors={[form.formState.errors.phone]} />
          </Field>
          <Field>
            <FieldLabel htmlFor="quick-source">Source</FieldLabel>
            <NativeSelect className="w-full" id="quick-source" {...form.register("source")}>
              {VISITOR_SOURCES.map((source) => (
                <NativeSelectOption key={source} value={source}>
                  {VISITOR_SOURCE_LABELS[source]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor="quick-method">Preferred contact</FieldLabel>
            <NativeSelect className="w-full" id="quick-method" {...form.register("preferredMethod")}>
              {CONTACT_METHODS.map((method) => (
                <NativeSelectOption key={method} value={method}>
                  {CONTACT_METHOD_LABELS[method]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor="quick-assignee">Assign to</FieldLabel>
            <NativeSelect className="w-full" id="quick-assignee" {...form.register("assignedTo")}>
              <NativeSelectOption value="">Leave for the coordinator</NativeSelectOption>
              {assignableTeam.map((member) => (
                <NativeSelectOption key={member.id} value={member.id}>
                  {member.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
        </FieldGroup>

        <Field orientation="horizontal">
          <Checkbox
            id="quick-permission"
            checked={watched.permissionGranted}
            onCheckedChange={(checked) => form.setValue("permissionGranted", checked === true)}
          />
          <div>
            <FieldLabel htmlFor="quick-permission" className="font-normal">
              Happy to be contacted
            </FieldLabel>
            <FieldDescription>
              Leave unticked if they would rather not hear from us. The record is still created.
            </FieldDescription>
          </div>
        </Field>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit">Register and start the next one</Button>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <KeyboardIcon className="size-3.5" />
            <Kbd>Enter</Kbd> saves and clears the name fields
          </span>
        </div>
      </form>

      <aside className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold">Registered just now</h2>
          <p className="text-xs text-muted-foreground">
            {registered.length
              ? `${registered.length} registered in this session. A welcome follow-up was created for each one.`
              : "Nobody yet. Each person you add appears here."}
          </p>
        </div>
        <ul className="space-y-2">
          {registered.map((entry) => (
            <li key={entry.id}>
              <Item variant="outline" size="sm" render={<Link href={`/visitors/${entry.id}`} />}>
                <ItemContent>
                  <ItemTitle className="flex items-center gap-1.5">
                    <CheckCircle2Icon className="size-3.5 text-emerald-600 dark:text-emerald-500" />
                    {entry.name}
                  </ItemTitle>
                  <ItemDescription>Open the record</ItemDescription>
                </ItemContent>
              </Item>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
