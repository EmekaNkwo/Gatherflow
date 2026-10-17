"use client";

import { Suspense, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { AUTH_INPUT, AUTH_PRIMARY, AuthLink, AuthShell } from "@/components/auth/auth-shell";
import { authClient } from "@/lib/auth-client";

/** Email and password, one error message, and a full page load on success. */
export default function SignInPage() {
  return (
    <Suspense>
      <SignInForm />
    </Suspense>
  );
}

function SignInForm() {
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const outcome = await authClient.signIn.email({ email, password });
    if (outcome.error) {
      setError(outcome.error.message ?? "Those details were not recognised.");
      setSubmitting(false);
      return;
    }
    // A full load, not a client navigation: the store must start empty so no
    // church data from a previous session on this browser is shown.
    window.location.assign(next);
  }

  return (
    <AuthShell
      title="Welcome back"
      description="Sign in with the email your church invited, or the one you signed up with."
      footer={
        <p>
          New here? <AuthLink href="/sign-up">Create your church</AuthLink>
        </p>
      }
    >
      <form onSubmit={onSubmit} noValidate>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="sign-in-email">Email</FieldLabel>
            <Input
              id="sign-in-email"
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
            <FieldLabel htmlFor="sign-in-password">Password</FieldLabel>
            <Input
              id="sign-in-password"
              type="password"
              className={AUTH_INPUT}
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <Link
              href="/forgot-password"
              className="inline-flex min-h-11 w-fit! items-center text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Forgotten your password?
            </Link>
          </Field>

          {error ? (
            <Alert variant="destructive">
              <AlertTitle>That didn&apos;t work</AlertTitle>
              <AlertDescription>
                <span className="block">{error}</span>
                <span className="block">Try again, or choose &ldquo;Forgotten your password?&rdquo; above.</span>
              </AlertDescription>
            </Alert>
          ) : null}

          <Button type="submit" size="lg" className={AUTH_PRIMARY} disabled={submitting || !email || !password}>
            {submitting ? "Signing in…" : "Sign in"}
          </Button>
        </FieldGroup>
      </form>
    </AuthShell>
  );
}

/** Only same-origin paths; a `next` pointing elsewhere is ignored. */
function safeNext(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/dashboard";
  return value;
}
