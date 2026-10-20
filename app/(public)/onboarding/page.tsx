"use client";

import { showFormError } from "@/lib/form-toast";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { AUTH_INPUT, AUTH_PRIMARY, AuthShell } from "@/components/auth/auth-shell";

/**
 * A signed-in account that belongs to no church yet: create one, or use the
 * invitation link somebody sent. Nothing else is possible from here, by
 * design — a church is not something a stranger can join by asking.
 */
/** What went wrong, as a toast: the server"s words, then what to do next. */
function showError(message: string): void {
  showFormError("Could not create the church", message, "Check the name and try again.");
}

export default function OnboardingPage() {
  const [churchName, setChurchName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
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
      showError(envelope.error ?? "The church could not be created.");
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

          <Button type="submit" size="lg" className={AUTH_PRIMARY} disabled={submitting || churchName.trim().length < 2}>
            {submitting ? "Creating…" : "Create church"}
          </Button>
        </FieldGroup>
      </form>
    </AuthShell>
  );
}
