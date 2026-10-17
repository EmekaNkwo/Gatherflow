"use client";

import { useState, type FormEvent } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { AUTH_INPUT, AUTH_PRIMARY, AuthDone, AuthLink, AuthShell } from "@/components/auth/auth-shell";
import { authClient } from "@/lib/auth-client";

/**
 * Asks for a reset link. The answer is the same whether or not the address
 * has an account, so the page cannot be used to find out who is a member.
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    const outcome = await authClient.requestPasswordReset({
      email,
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setSubmitting(false);
    if (outcome.error) {
      setError(outcome.error.message ?? "The link could not be sent.");
      return;
    }
    setSent(true);
  }

  return (
    <AuthShell
      title={sent ? "Check your email" : "Forgotten your password?"}
      description={
        sent ? undefined : "It happens. Tell us your email and we'll send a link to choose a new one."
      }
      footer={<AuthLink href="/sign-in">Back to sign in</AuthLink>}
    >
      {sent ? (
        <AuthDone>
          If <strong>{email}</strong> has an account, a reset link is on its way. It works for one
          hour, so open it soon. Nothing arrived? Look in your spam folder.
        </AuthDone>
      ) : (
        <form onSubmit={onSubmit} noValidate>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="forgot-email">Email</FieldLabel>
              <Input id="forgot-email" type="email" inputMode="email" className={AUTH_INPUT} autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} />
            </Field>
            {error ? (
              <Alert variant="destructive">
                <AlertTitle>Could not send the link</AlertTitle>
                <AlertDescription>
                  <span className="block">{error}</span>
                  <span className="block">Check the address and try again in a moment.</span>
                </AlertDescription>
              </Alert>
            ) : null}
            <Button type="submit" size="lg" className={AUTH_PRIMARY} disabled={submitting || !email}>
              {submitting ? "Sending…" : "Send reset link"}
            </Button>
          </FieldGroup>
        </form>
      )}
    </AuthShell>
  );
}
