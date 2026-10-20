"use client";

import { showFormError } from "@/lib/form-toast";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { AUTH_INPUT, AUTH_PRIMARY, AuthLink, AuthShell } from "@/components/auth/auth-shell";
import { authClient } from "@/lib/auth-client";
import {
  DEFAULT_RETRY_SECONDS,
  notifyRateLimited,
  rateLimitedMessage,
  retryAfterCapture,
  retryAfterSeconds,
  tryAgainIn,
} from "@/lib/rate-limit";
import { useCooldown } from "@/hooks/useCooldown";
import { DEMO_ROLE_LABELS, type DemoRole } from "@/types/team";

interface Invitation {
  churchName: string;
  role: DemoRole;
  email: string;
  expiresAt: string;
}

/**
 * The end of an invitation link.
 *
 * Shows what the link is for, then gets the person an account with the
 * invited address — sign in if they have one, sign up if not — and accepts.
 * The server checks that the account's address matches the invitation's;
 * the page merely makes that the easy path.
 */
/** What went wrong, as a toast: the server"s words, then what to do next. */
function showError(message: string): void {
  showFormError("Not joined yet", message);
}

export default function AcceptInvitePage() {
  return (
    <Suspense>
      <AcceptInvite />
    </Suspense>
  );
}

function AcceptInvite() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [mode, setMode] = useState<"checking" | "sign-up" | "sign-in" | "accepting" | "done">("checking");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  // Too many lookups from this connection: the invitation may be fine, so
  // this is a wait, not a problem with the link.
  const [lookupWait, setLookupWait] = useState<number | null>(null);
  const cooldown = useCooldown();

  function waitBeforeRetrying(seconds: number) {
    cooldown.start(seconds);
    notifyRateLimited(seconds);
  }

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/invitations/${encodeURIComponent(token)}`, { signal: controller.signal })
      .then(async (response) => {
        const envelope = (await response.json()) as { ok: boolean; data?: Invitation; error?: string };
        // A cancelled lookup must not show a problem or accept a second time.
        if (controller.signal.aborted) return;
        if (response.status === 429) {
          const seconds = retryAfterSeconds(response.headers);
          setLookupWait(seconds);
          waitBeforeRetrying(seconds);
          return;
        }
        if (!envelope.ok || !envelope.data) {
          setProblem(envelope.error ?? "That invitation is not valid.");
          return;
        }
        setInvitation(envelope.data);
        // Already signed in? Try accepting straight away.
        const session = await authClient.getSession();
        if (session.data?.user) {
          setMode("accepting");
          await accept();
        } else {
          setMode("sign-up");
        }
      })
      .catch(() => {
        // Leaving the page (or React mounting it twice in development)
        // cancels the request; that is not a failure to report.
        if (controller.signal.aborted) return;
        setProblem("Could not reach the server.");
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function accept() {
    const response = await fetch(`/api/invitations/${encodeURIComponent(token)}/accept`, { method: "POST" });
    const envelope = (await response.json()) as { ok: boolean; error?: string; code?: string };
    if (response.status === 429) {
      waitBeforeRetrying(retryAfterSeconds(response.headers));
      setMode("sign-in");
      return;
    }
    if (!envelope.ok) {
      showError(envelope.error ?? "The invitation could not be accepted.");
      setMode(envelope.code === "wrong_account" ? "sign-in" : "sign-up");
      return;
    }
    setMode("done");
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/dashboard");
  }

  async function onSignUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!invitation) return;
    setMode("accepting");
    const retry = retryAfterCapture();
    const signedUp = await authClient.signUp.email({
      name,
      email: invitation.email,
      password,
      fetchOptions: retry.fetchOptions,
    });
    if (signedUp.error?.status === 429) {
      waitBeforeRetrying(retry.seconds() ?? DEFAULT_RETRY_SECONDS);
      setMode("sign-up");
      return;
    }
    if (signedUp.error) {
      showError(signedUp.error.message ?? "The account could not be created.");
      setMode("sign-up");
      return;
    }
    await accept();
  }

  async function onSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!invitation) return;
    setMode("accepting");
    const retry = retryAfterCapture();
    const signedIn = await authClient.signIn.email({
      email: invitation.email,
      password,
      fetchOptions: retry.fetchOptions,
    });
    if (signedIn.error?.status === 429) {
      waitBeforeRetrying(retry.seconds() ?? DEFAULT_RETRY_SECONDS);
      setMode("sign-in");
      return;
    }
    if (signedIn.error) {
      showError(signedIn.error.message ?? "Those details were not recognised.");
      setMode("sign-in");
      return;
    }
    await accept();
  }

  if (lookupWait !== null) {
    return (
      <AuthShell title="Please wait a moment" description={rateLimitedMessage(lookupWait)}>
        <Button
          size="lg"
          className={AUTH_PRIMARY}
          disabled={cooldown.active}
          onClick={() => window.location.reload()}
        >
          {cooldown.active ? tryAgainIn(cooldown.remaining) : "Try again"}
        </Button>
      </AuthShell>
    );
  }

  if (problem) {
    return (
      <AuthShell title="This invitation can't be used" description={problem}>
        <p className="text-base text-muted-foreground">
          Invitations last a limited time and work once. Ask whoever invited you to send a fresh
          one, or sign in if you already joined.
        </p>
        <div className="mt-4">
          <AuthLink href="/sign-in">Sign in instead</AuthLink>
        </div>
      </AuthShell>
    );
  }
  if (!invitation || mode === "checking" || mode === "accepting" || mode === "done") {
    return (
      <AuthShell title="Checking your invitation…">
        <p role="status" className="text-base text-muted-foreground">
          One moment while we get things ready.
        </p>
      </AuthShell>
    );
  }

  const intro = (
    <>
      You&apos;ve been invited to join <strong className="text-foreground">{invitation.churchName}</strong> as{" "}
      {DEMO_ROLE_LABELS[invitation.role].toLowerCase()}. You&apos;ll sign in with{" "}
      <strong className="text-foreground">{invitation.email}</strong>.
    </>
  );

  return (
    <AuthShell
      title={mode === "sign-up" ? "Welcome to the team" : "Sign in to join"}
      description={intro}
      footer={
        mode === "sign-up" ? (
          <button
            type="button"
            className="min-h-11 font-medium text-primary underline-offset-4 hover:underline"
            onClick={() => setMode("sign-in")}
          >
            I already have an account with this address
          </button>
        ) : (
          <button
            type="button"
            className="min-h-11 font-medium text-primary underline-offset-4 hover:underline"
            onClick={() => setMode("sign-up")}
          >
            I need to create an account
          </button>
        )
      }
    >
      <form onSubmit={mode === "sign-up" ? onSignUp : onSignIn} noValidate>
        <FieldGroup>
          {mode === "sign-up" ? (
            <Field>
              <FieldLabel htmlFor="invite-name">Your name</FieldLabel>
              <Input id="invite-name" className={AUTH_INPUT} autoComplete="name" required value={name} onChange={(event) => setName(event.target.value)} />
              <FieldDescription>As your team will see it.</FieldDescription>
            </Field>
          ) : null}
          <Field>
            <FieldLabel htmlFor="invite-password">{mode === "sign-up" ? "Choose a password" : "Password"}</FieldLabel>
            <Input
              id="invite-password"
              type="password"
              className={AUTH_INPUT}
              autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
              required
              minLength={mode === "sign-up" ? 12 : undefined}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            {mode === "sign-up" ? <FieldDescription>At least 12 characters.</FieldDescription> : null}
          </Field>

          <Button
            type="submit"
            size="lg"
            className={AUTH_PRIMARY}
            disabled={cooldown.active || !password || (mode === "sign-up" && (!name || password.length < 12))}
          >
            {cooldown.active
              ? tryAgainIn(cooldown.remaining)
              : mode === "sign-up"
                ? "Create account and join"
                : "Sign in and join"}
          </Button>
        </FieldGroup>
      </form>
    </AuthShell>
  );
}
