"use client";

import { useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2Icon, ChurchIcon, QrCodeIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { ChurchDataProvider } from "@/components/providers/church-data-provider";
import { toIsoDate } from "@/lib/dates";
import { CONTACT_METHODS, CONTACT_METHOD_LABELS } from "@/types/common";
import {
  selfRegistrationSchema,
  type SelfRegistrationValues,
} from "@/services/visitors/schema";
import { useNow } from "@/hooks/use-now";
import { useSnapshot } from "@/hooks/use-church-data";
import { useVisitors } from "@/hooks/useVisitors";

/**
 * The public welcome page, reached from a QR code on a welcome card.
 *
 * Deliberately separate from the operations dashboard: it asks for the least
 * it can, makes contact permission an explicit choice, and shows nothing
 * about anybody else.
 */
export default function ConnectPage() {
  return (
    <ChurchDataProvider>
      <ConnectForm />
    </ChurchDataProvider>
  );
}

function ConnectForm() {
  const now = useNow();
  const snapshot = useSnapshot();
  const { register: registerVisitor } = useVisitors();
  const [done, setDone] = useState(false);

  const todaysSession = useMemo(() => {
    const today = toIsoDate(now);
    return (
      snapshot.sessions.find((session) => session.date === today) ??
      [...snapshot.sessions]
        .filter((session) => session.date <= today)
        .sort((left, right) => (left.date < right.date ? 1 : -1))[0]
    );
  }, [snapshot.sessions, now]);

  const form = useForm<SelfRegistrationValues>({
    resolver: zodResolver(selfRegistrationSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      phone: "",
      email: "",
      firstVisit: true,
      preferredMethod: "whatsapp",
      permissionGranted: false,
    },
  });

  const watched = useWatch({ control: form.control });

  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await registerVisitor({
      firstName: values.firstName,
      lastName: values.lastName,
      phone: values.phone || undefined,
      email: values.email || undefined,
      visitDate: toIsoDate(now),
      sessionId: todaysSession?.id,
      source: "walk_in",
      preferredMethod: values.preferredMethod,
      permissionGranted: values.permissionGranted,
      selfRegistered: true,
      returningVisitor: !values.firstVisit,
    });

    if (outcome.ok) setDone(true);
  });

  if (done) {
    return (
      <Shell churchName={snapshot.settings.churchName}>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2Icon className="size-5 text-emerald-600 dark:text-emerald-500" />
              Thank you
            </CardTitle>
            <CardDescription>
              We are really glad you joined us. If you asked us to get in touch, someone from the
              welcome team will be in contact.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              onClick={() => {
                form.reset();
                setDone(false);
              }}
            >
              Register someone else
            </Button>
          </CardContent>
        </Card>
      </Shell>
    );
  }

  return (
    <Shell churchName={snapshot.settings.churchName}>
      <Card>
        <CardHeader>
          <CardTitle>Welcome to {snapshot.settings.churchName}</CardTitle>
          <CardDescription>
            We&apos;re glad you joined us{todaysSession ? ` at ${todaysSession.name}` : ""}. If
            you&apos;d like, leave your details and we&apos;ll say hello. Only your name is
            needed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-5">
            <FieldGroup className="sm:grid sm:grid-cols-2 sm:gap-4">
              <Field>
                <FieldLabel htmlFor="connect-firstName">First name</FieldLabel>
                <Input
                  id="connect-firstName"
                  autoComplete="given-name"
                  {...form.register("firstName")}
                />
                <FieldError errors={[form.formState.errors.firstName]} />
              </Field>
              <Field>
                <FieldLabel htmlFor="connect-lastName">Last name</FieldLabel>
                <Input
                  id="connect-lastName"
                  autoComplete="family-name"
                  {...form.register("lastName")}
                />
                <FieldError errors={[form.formState.errors.lastName]} />
              </Field>
              <Field>
                <FieldLabel htmlFor="connect-phone">Phone number (optional)</FieldLabel>
                <Input
                  id="connect-phone"
                  inputMode="tel"
                  autoComplete="tel"
                  {...form.register("phone")}
                />
                <FieldError errors={[form.formState.errors.phone]} />
              </Field>
              <Field>
                <FieldLabel htmlFor="connect-email">Email (optional)</FieldLabel>
                <Input
                  id="connect-email"
                  type="email"
                  autoComplete="email"
                  {...form.register("email")}
                />
                <FieldError errors={[form.formState.errors.email]} />
              </Field>
            </FieldGroup>

            <Field orientation="horizontal">
              <Checkbox
                id="connect-first-visit"
                checked={watched.firstVisit}
                onCheckedChange={(checked) => form.setValue("firstVisit", checked === true)}
              />
              <FieldLabel htmlFor="connect-first-visit" className="font-normal">
                This is my first visit
              </FieldLabel>
            </Field>

            <Field>
              <FieldLabel htmlFor="connect-method">
                How would you prefer us to contact you?
              </FieldLabel>
              <NativeSelect
                className="w-full sm:w-64"
                id="connect-method"
                {...form.register("preferredMethod")}
              >
                {CONTACT_METHODS.map((method) => (
                  <NativeSelectOption key={method} value={method}>
                    {CONTACT_METHOD_LABELS[method]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>

            <Field orientation="horizontal">
              <Checkbox
                id="connect-permission"
                checked={watched.permissionGranted}
                onCheckedChange={(checked) =>
                  form.setValue("permissionGranted", checked === true)
                }
              />
              <div>
                <FieldLabel htmlFor="connect-permission" className="font-normal">
                  Yes, the church may contact me
                </FieldLabel>
                <FieldDescription>
                  Leave this unticked and nobody will message or call you. You can always change
                  your mind by telling someone on the welcome desk.
                </FieldDescription>
              </div>
            </Field>

            <Button type="submit" className="w-full sm:w-auto">
              Submit
            </Button>
          </form>
        </CardContent>
      </Card>
    </Shell>
  );
}

function Shell({
  churchName,
  children,
}: {
  churchName: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-svh w-full max-w-xl flex-col gap-6 p-4 sm:p-8">
      <header className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <ChurchIcon className="size-5" />
        </span>
        <div>
          <p className="font-semibold">{churchName}</p>
          <p className="text-xs text-muted-foreground">Visitor welcome</p>
        </div>
      </header>

      {children}

      <footer className="mt-auto space-y-2 text-xs text-muted-foreground">
        <p className="flex items-center gap-1.5">
          <QrCodeIcon className="size-3.5" />
          This page stands in for a QR-code welcome card. It stores nothing about anyone else and
          shows no church records.
        </p>
        <p>
          GatherFlow is a portfolio demonstration. All data stays in this browser and is
          synthetic.
        </p>
      </footer>
    </div>
  );
}
