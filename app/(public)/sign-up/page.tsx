"use client";

import { showFormError } from "@/lib/form-toast";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { AUTH_INPUT, AUTH_PRIMARY, AuthLink, AuthShell } from "@/components/auth/auth-shell";
import { authClient } from "@/lib/auth-client";
import { useCooldown } from "@/hooks/useCooldown";
import { DEFAULT_RETRY_SECONDS, notifyRateLimited, retryAfterCapture, tryAgainIn } from "@/lib/rate-limit";

/**
 * Creating an account and a church in one go.
 *
 * Two requests, in order: the account through Better Auth, then the church
 * through the application, which makes the new account its administrator.
 * If the second fails the account still exists, and `/onboarding` lets the
 * person try the church again rather than leaving them stuck.
 */
/** What went wrong, as a toast: the server"s words, then what to do next. */
function showError(message: string): void {
  showFormError("Could not create the account", message, "If you already have an account with this email, sign in instead.");
}

export default function SignUpPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [churchName, setChurchName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const cooldown = useCooldown();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);

    const retry = retryAfterCapture();
    const signedUp = await authClient.signUp.email({ name, email, password, fetchOptions: retry.fetchOptions });
    if (signedUp.error) {
      setSubmitting(false);
      if (signedUp.error.status === 429) {
        const seconds = retry.seconds() ?? DEFAULT_RETRY_SECONDS;
        cooldown.start(seconds);
        notifyRateLimited(seconds);
        return;
      }
      showError(signedUp.error.message ?? "The account could not be created.");
      return;
    }

    const created = await fetch("/api/churches", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: churchName }),
    });
    if (!created.ok) {
      // The account exists; the church can be created from onboarding.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign("/onboarding");
      return;
    }
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/dashboard");
  }

  return (
    <AuthShell
      title="Create your church"
      description="It takes a minute. You'll look after it, and invite the rest of your team once you're in."
      footer={
        <p>
          Already have an account? <AuthLink href="/sign-in">Sign in</AuthLink>
        </p>
      }
    >
      <form onSubmit={onSubmit} noValidate>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="sign-up-church">Church name</FieldLabel>
            <Input
              id="sign-up-church"
              className={AUTH_INPUT}
              placeholder="e.g. Grace Community Church"
              required
              maxLength={120}
              value={churchName}
              onChange={(event) => setChurchName(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="sign-up-name">Your name</FieldLabel>
            <Input
              id="sign-up-name"
              className={AUTH_INPUT}
              autoComplete="name"
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="sign-up-email">Email</FieldLabel>
            <Input
              id="sign-up-email"
              type="email"
              inputMode="email"
              className={AUTH_INPUT}
              autoComplete="username"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="sign-up-password">Password</FieldLabel>
            <Input
              id="sign-up-password"
              className={AUTH_INPUT}
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <FieldDescription>At least 12 characters. A short phrase you will remember works well.</FieldDescription>
          </Field>

          <Button
            type="submit"
            size="lg"
            className={AUTH_PRIMARY}
            disabled={submitting || cooldown.active || !name || !email || password.length < 12 || churchName.trim().length < 2}
          >
            {cooldown.active ? tryAgainIn(cooldown.remaining) : submitting ? "Creating…" : "Create church"}
          </Button>
        </FieldGroup>
      </form>
    </AuthShell>
  );
}
