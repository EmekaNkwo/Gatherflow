"use client";

import { useMemo, useState } from "react";
import { LinkButton } from "@/components/shared/link-button";
import { Card, CardContent } from "@/components/ui/card";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { PageHeader, PageShell } from "@/components/shared/page-header";
import { RestrictedState } from "@/components/shared/empty-state";
import { QuickRegisterForm } from "@/components/visitors/quick-register-form";
import { toIsoDate } from "@/lib/dates";
import { useDemoRole } from "@/hooks/useDemoRole";
import { useNow } from "@/hooks/use-now";
import { useSnapshot } from "@/hooks/use-church-data";

/**
 * Quick registration mode for the welcome desk: pick the service once, then
 * work through the queue of visitors one after another.
 */
export default function QuickRegistrationPage() {
  const now = useNow();
  const snapshot = useSnapshot();
  const { can } = useDemoRole();

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

  return (
    <PageShell>
      <PageHeader
        title="Quick registration"
        description="A short form for registering several visitors in a row. Each one gets a welcome follow-up task automatically."
        actions={
          <LinkButton variant="outline" size="sm" href="/visitors/new">
            Switch to the full form
          </LinkButton>
        }
      />

      <Card>
        <CardContent className="space-y-6">
          <Field className="max-w-sm">
            <FieldLabel htmlFor="quick-session">Service being registered against</FieldLabel>
            <NativeSelect
              className="w-full"
              id="quick-session"
              value={sessionId}
              onChange={(event) => setSessionId(event.target.value)}
            >
              <NativeSelectOption value="">Do not record attendance</NativeSelectOption>
              {sessions.map((session) => (
                <NativeSelectOption key={session.id} value={session.id}>
                  {session.name} · {session.date}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <FieldDescription>
              Everyone registered below is also checked in to this service, so visit counts come
              from real attendance records.
            </FieldDescription>
          </Field>

          <QuickRegisterForm sessionId={sessionId || undefined} />
        </CardContent>
      </Card>
    </PageShell>
  );
}
