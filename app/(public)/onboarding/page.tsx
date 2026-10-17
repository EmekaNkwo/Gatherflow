"use client";

import { useState, type FormEvent } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { AUTH_INPUT, AUTH_PRIMARY, AuthShell } from "@/components/auth/auth-shell";

/**
 * A signed-in account that belongs to no church yet: create one, or use the
 * invitation link somebody sent. Nothing else is possible from here, by
 * design — a church is not something a stranger can join by asking.
 */
export default function OnboardingPage() {
  const [churchName, setChurchName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    const response = await fetch("/api/churches", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: churchName }),
    });
    const envelope = (await response.json()) as { ok: boolean; error?: string; code?: string };
    if (!envelope.ok) {
      if (envelope.code === "unauthenticated") {
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.assign("/sign-in?next=/onboarding");
        return;
      }
      setError(envelope.error ?? "The church could not be created.");
      setSubmitting(false);
      return;
    }
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/dashboard");
  }

  return (
    <AuthShell
      title="Let's set up your church"
      description="Your account isn't part of a church yet. Name yours below and you'll look after it. Joining someone else's? Open the invitation link they emailed you instead."
    >
      <form onSubmit={onSubmit} noValidate>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="onboarding-church">Church name</FieldLabel>
            <Input
              id="onboarding-church"
              className={AUTH_INPUT}
              placeholder="e.g. Grace Community Church"
              required
              maxLength={120}
              value={churchName}
              onChange={(event) => setChurchName(event.target.value)}
            />
            <FieldDescription>You can change it later in Settings.</FieldDescription>
          </Field>

          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Could not create the church</AlertTitle>
              <AlertDescription>
                <span className="block">{error}</span>
                <span className="block">Check the name and try again.</span>
              </AlertDescription>
            </Alert>
          ) : null}

          <Button type="submit" size="lg" className={AUTH_PRIMARY} disabled={submitting || churchName.trim().length < 2}>
            {submitting ? "Creating…" : "Create church"}
          </Button>
        </FieldGroup>
      </form>
    </AuthShell>
  );
}
