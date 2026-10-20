"use client";

import { showFormError } from "@/lib/form-toast";
import { toast } from "sonner";
import { Suspense, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { AUTH_INPUT, AUTH_PRIMARY, AuthDone, AuthLink, AuthShell } from "@/components/auth/auth-shell";
import { LinkButton } from "@/components/shared/link-button";
import { authClient } from "@/lib/auth-client";

/** The end of a reset link: a new password, once. */
/** What went wrong, as a toast: the server"s words, then what to do next. */
function showError(message: string): void {
  showFormError("Could not change the password", message, "If it keeps happening, ask for a new reset link.");
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}

function ResetPasswordForm() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const expired = params.get("error") === "INVALID_TOKEN";
  const [password, setPassword] = useState("");
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    const outcome = await authClient.resetPassword({ newPassword: password, token });
    setSubmitting(false);
    if (outcome.error) {
      showError(outcome.error.message ?? "The password could not be changed.");
      return;
    }
    setDone(true);
    toast.success("Password changed");
  }

  if (expired || !token) {
    return (
      <AuthShell
        title="This link has expired"
        description="Reset links work for one hour, and only once. Ask for a fresh one and it'll be with you in a minute."
        footer={<AuthLink href="/sign-in">Back to sign in</AuthLink>}
      >
        <LinkButton href="/forgot-password" size="lg" className={AUTH_PRIMARY}>
          Send me a new link
        </LinkButton>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={done ? "All set" : "Choose a new password"}
      description={done ? undefined : "Pick something you'll remember. You'll use it to sign in from now on."}
    >
      {done ? (
        <div className="space-y-6">
          <AuthDone>Your password has been changed. Sign in with it now.</AuthDone>
          <LinkButton href="/sign-in" size="lg" className={AUTH_PRIMARY}>
            Sign in
          </LinkButton>
        </div>
      ) : (
        <form onSubmit={onSubmit} noValidate>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="reset-password">New password</FieldLabel>
              <Input id="reset-password" type="password" className={AUTH_INPUT} autoComplete="new-password" required minLength={12} value={password} onChange={(event) => setPassword(event.target.value)} />
              <FieldDescription>At least 12 characters.</FieldDescription>
            </Field>
            <Button type="submit" size="lg" className={AUTH_PRIMARY} disabled={submitting || password.length < 12}>
              {submitting ? "Saving…" : "Change password"}
            </Button>
          </FieldGroup>
        </form>
      )}
    </AuthShell>
  );
}
