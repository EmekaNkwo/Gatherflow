"use client";

import { showFormError } from "@/lib/form-toast";
import { toast } from "sonner";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { AUTH_INPUT, AUTH_PRIMARY, AuthDone, AuthLink, AuthShell } from "@/components/auth/auth-shell";
import { authClient } from "@/lib/auth-client";
import { useCooldown } from "@/hooks/useCooldown";
import { DEFAULT_RETRY_SECONDS, notifyRateLimited, retryAfterCapture, tryAgainIn } from "@/lib/rate-limit";

/**
 * Asks for a reset link. The answer is the same whether or not the address
 * has an account, so the page cannot be used to find out who is a member.
 */
/** What went wrong, as a toast: the server"s words, then what to do next. */
function showError(message: string): void {
  showFormError("Could not send the link", message, "Check the address and try again in a moment.");
}

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const cooldown = useCooldown();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    const retry = retryAfterCapture();
    const outcome = await authClient.requestPasswordReset({
      email,
      redirectTo: `${window.location.origin}/reset-password`,
      fetchOptions: retry.fetchOptions,
    });
    setSubmitting(false);
    if (outcome.error?.status === 429) {
      const seconds = retry.seconds() ?? DEFAULT_RETRY_SECONDS;
      cooldown.start(seconds);
      notifyRateLimited(seconds);
      return;
    }
    if (outcome.error) {
      showError(outcome.error.message ?? "The link could not be sent.");
      return;
    }
    setSent(true);
    toast.success("Reset link sent", { description: "Check your email." });
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
            <Button type="submit" size="lg" className={AUTH_PRIMARY} disabled={submitting || cooldown.active || !email}>
              {cooldown.active ? tryAgainIn(cooldown.remaining) : submitting ? "Sending…" : "Send reset link"}
            </Button>
          </FieldGroup>
        </form>
      )}
    </AuthShell>
  );
}
