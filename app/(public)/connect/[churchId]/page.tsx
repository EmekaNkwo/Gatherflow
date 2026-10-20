"use client";

import { showFormError } from "@/lib/form-toast";
import { toast } from "sonner";
import { use, useEffect, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/shared/select-field";
import { AUTH_INPUT, AUTH_PRIMARY } from "@/components/auth/auth-shell";
import { WelcomeShell, WelcomeThanks } from "@/components/auth/welcome-shell";
import { CONTACT_METHODS, CONTACT_METHOD_LABELS } from "@/types/common";
import {
  selfRegistrationSchema,
  type SelfRegistrationValues,
} from "@/services/visitors/schema";

const CONTACT_METHOD_OPTIONS = CONTACT_METHODS.map((method) => ({
  value: method,
  label: CONTACT_METHOD_LABELS[method],
}));

/**
 * The public welcome page, reached from a QR code on a welcome card — on the
 * visitor's own phone, often while the service is still going on.
 *
 * Deliberately separate from the operations dashboard: it asks for the least
 * it can, makes contact permission an explicit choice, and shows nothing
 * about anybody else. The only thing it knows is the church's name, and the
 * only thing it does is post a registration to the church.
 */
/** What went wrong, as a toast: the server"s words, then what to do next. */
function showError(message: string): void {
  showFormError("Not saved yet", message);
}

export default function ConnectPage({ params }: { params: Promise<{ churchId: string }> }) {
  const { churchId } = use(params);
  const [churchName, setChurchName] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/public/church/${encodeURIComponent(churchId)}`, { signal: controller.signal })
      .then(async (response) => {
        const envelope = (await response.json()) as { ok: boolean; data?: { name: string } };
        if (controller.signal.aborted) return;
        if (envelope.ok && envelope.data) setChurchName(envelope.data.name);
        else setInvalid(true);
      })
      .catch(() => {
        // Leaving the page (or React mounting it twice in development)
        // cancels the request; that says nothing about the link.
        if (controller.signal.aborted) return;
        setInvalid(true);
      });
    return () => controller.abort();
  }, [churchId]);

  if (invalid) {
    return (
      <WelcomeShell>
        <section className="rounded-[2rem] bg-warm px-6 py-8">
          <h1 className="text-3xl leading-tight font-medium">This link is not valid</h1>
          <p className="mt-3 text-lg text-pretty">
            It may have been copied incompletely. Ask someone at the welcome desk for the right one,
            or scan the code on the welcome card again.
          </p>
        </section>
      </WelcomeShell>
    );
  }

  if (churchName === null) {
    return (
      <WelcomeShell>
        <section aria-busy="true" className="rounded-[2rem] bg-warm px-6 py-10">
          <p role="status" className="text-lg text-muted-foreground">
            Just a moment…
          </p>
        </section>
      </WelcomeShell>
    );
  }

  return (
    <WelcomeShell churchName={churchName}>
      <ConnectForm churchId={churchId} churchName={churchName} />
    </WelcomeShell>
  );
}

function ConnectForm({ churchId, churchName }: { churchId: string; churchName: string }) {
  const [done, setDone] = useState<{ firstName: string; contacted: boolean } | null>(null);

  const form = useForm<SelfRegistrationValues>({
    resolver: zodResolver(selfRegistrationSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      phone: "",
      email: "",
      firstVisit: true,
      preferredMethod: "whatsapp",
      // Consent is asked, never assumed: unticked until the visitor says yes.
      permissionGranted: false,
    },
  });
  const watched = useWatch({ control: form.control });
  const errors = form.formState.errors;

  const onSubmit = form.handleSubmit(async (values) => {
    let envelope: { ok: boolean; error?: string };
    try {
      const response = await fetch("/api/public/connect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ churchId, ...values, website: "" }),
      });
      envelope = (await response.json()) as { ok: boolean; error?: string };
    } catch {
      showError("We couldn't reach the church just now. Check your connection and try again.");
      return;
    }
    if (envelope.ok) {
      setDone({ firstName: values.firstName.trim(), contacted: values.permissionGranted });
      toast.success("Your details are saved");
    } else {
      showError(envelope.error ?? "Your details could not be saved. Please tell the welcome desk.");
    }
  });

  if (done) {
    return (
      <WelcomeThanks
        churchName={churchName}
        firstName={done.firstName}
        contacted={done.contacted}
        onAnother={() => {
          form.reset();
          setDone(null);
        }}
      />
    );
  }

  return (
    <>
      <section className="rounded-[2rem] bg-warm px-6 py-8 sm:px-8 sm:py-10">
        <h1 className="text-[clamp(2rem,7vw,2.75rem)] leading-[1.1] font-medium text-balance">
          Welcome to {churchName}
        </h1>
        <p className="mt-4 text-lg text-pretty">
          We&apos;re so glad you&apos;re here. If you&apos;d like, leave your name and we&apos;ll
          say hello. It takes less than a minute.
        </p>
      </section>

      <form onSubmit={onSubmit} className="space-y-6" noValidate>

        <FieldGroup className="gap-4 sm:grid sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="connect-firstName">First name</FieldLabel>
            <Input id="connect-firstName" className={AUTH_INPUT} autoComplete="given-name" {...form.register("firstName")} />
            <FieldError errors={[errors.firstName]} />
          </Field>
          <Field>
            <FieldLabel htmlFor="connect-lastName">Last name</FieldLabel>
            <Input id="connect-lastName" className={AUTH_INPUT} autoComplete="family-name" {...form.register("lastName")} />
            <FieldError errors={[errors.lastName]} />
          </Field>
          <Field className="sm:col-span-2">
            <FieldLabel htmlFor="connect-phone">
              Phone number <span className="font-normal text-muted-foreground">(optional)</span>
            </FieldLabel>
            <Input id="connect-phone" className={AUTH_INPUT} inputMode="tel" autoComplete="tel" {...form.register("phone")} />
            <FieldError errors={[errors.phone]} />
          </Field>
          <Field className="sm:col-span-2">
            <FieldLabel htmlFor="connect-email">
              Email <span className="font-normal text-muted-foreground">(optional)</span>
            </FieldLabel>
            <Input id="connect-email" className={AUTH_INPUT} type="email" inputMode="email" autoComplete="email" {...form.register("email")} />
            <FieldError errors={[errors.email]} />
          </Field>
        </FieldGroup>

        {/* Bots fill every field; people never see this one. */}
        <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />

        <label
          htmlFor="connect-first-visit"
          className="flex min-h-12 cursor-pointer items-center gap-3 px-1"
        >
          <Checkbox
            id="connect-first-visit"
            className="size-5"
            checked={watched.firstVisit}
            onCheckedChange={(checked) => form.setValue("firstVisit", checked === true)}
          />
          <span>This is my first time here</span>
        </label>

        <div className="space-y-3">
          <label
            htmlFor="connect-permission"
            className="flex min-h-16 cursor-pointer items-start gap-3 rounded-2xl border-2 px-4 py-4 has-data-checked:border-done has-data-checked:bg-done/8"
          >
            <Checkbox
              id="connect-permission"
              className="mt-0.5 size-5"
              checked={watched.permissionGranted}
              onCheckedChange={(checked) => form.setValue("permissionGranted", checked === true)}
            />
            <span>
              <span className="block font-medium">Yes, the church may contact me</span>
              <span className="mt-0.5 block text-sm text-muted-foreground">
                Leave this unticked and nobody will message or call you. You can change your mind
                any time by telling someone on the welcome desk.
              </span>
            </span>
          </label>

          {watched.permissionGranted ? (
            <Controller
              control={form.control}
              name="preferredMethod"
              render={({ field, fieldState }) => (
                <SelectField
                  id="connect-method"
                  label="The best way to reach you"
                  description="We'll only use the details you gave above."
                  triggerClassName="min-h-12"
                  value={field.value ?? ""}
                  onValueChange={field.onChange}
                  error={fieldState.error?.message}
                  options={CONTACT_METHOD_OPTIONS}
                />
              )}
            />
          ) : null}
        </div>

        <Button
          type="submit"
          size="lg"
          className={AUTH_PRIMARY}
          disabled={form.formState.isSubmitting}
        >
          {form.formState.isSubmitting ? "Sending…" : "Submit"}
        </Button>
      </form>
    </>
  );
}
