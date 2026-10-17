"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Field, FieldLabel } from "@/components/ui/field";
import { PageHeader, PageShell } from "@/components/shared/page-header";
import { RestrictedState } from "@/components/shared/empty-state";
import { QuickRegisterForm } from "@/components/visitors/quick-register-form";
import { formatDisplayDate, toIsoDate } from "@/lib/dates";
import { useRole } from "@/hooks/useRole";
import { useNow } from "@/hooks/use-now";
import { useSnapshot } from "@/hooks/use-church-data";

/**
 * Welcoming somebody new, made for the welcome desk and a phone: the
 * service is chosen once (most recent by default), then people are added one
 * after another.
 */
export default function QuickRegistrationPage() {
  const now = useNow();
  const snapshot = useSnapshot();
  const { can } = useRole();

  const sessions = useMemo(
    () =>
      [...snapshot.sessions]
        .filter((session) => session.date <= toIsoDate(now))
        .sort((left, right) => (left.date < right.date ? 1 : -1))
        .slice(0, 6),
    [snapshot.sessions, now],
  );

  const [sessionId, setSessionId] = useState(sessions[0]?.id ?? "");

  if (!can("visitors.write")) {
    return (
      <PageShell>
        <RestrictedState section="Visitor registration" />
      </PageShell>
    );
  }

  const chosen = sessions.find((session) => session.id === sessionId);

  return (
    <PageShell className="max-w-2xl">
      <PageHeader
        title="Welcome someone new"
        description="A name is enough to start. We’ll make sure somebody says hello."
      />

      <details className="group rounded-2xl bg-muted px-4 py-3">
        <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-3">
          <span>
            {chosen ? (
              <>
                Checking them in to <strong>{chosen.name}</strong>, {formatDisplayDate(chosen.date)}
              </>
            ) : (
              "Not checking them in to a service"
            )}
          </span>
          <span className="text-sm font-medium text-primary">Change</span>
        </summary>
        <Field className="mt-3 max-w-sm">
          <FieldLabel htmlFor="quick-session">Service</FieldLabel>
          <NativeSelect
            className="w-full"
            id="quick-session"
            value={sessionId}
            onChange={(event) => setSessionId(event.target.value)}
          >
            <NativeSelectOption value="">Don&apos;t check them in</NativeSelectOption>
            {sessions.map((session) => (
              <NativeSelectOption key={session.id} value={session.id}>
                {session.name} · {formatDisplayDate(session.date)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
      </details>

      <QuickRegisterForm sessionId={sessionId || undefined} />

      <p className="text-sm text-muted-foreground">
        Need to record more, like an address or household?{" "}
        <Link href="/visitors/new" className="font-medium text-primary underline-offset-4 hover:underline">
          Use the full form
        </Link>
        .
      </p>
    </PageShell>
  );
}
