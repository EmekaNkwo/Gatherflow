"use client";

import { useState, type FormEvent } from "react";
import { AtSignIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { changeAccountEmail } from "@/services/commands/client";

interface EmailCardProps {
  currentEmail: string | null;
}

/**
 * The address the account signs in with. Changing it sends a link to the new
 * address; nothing moves until that link is opened.
 */
export function EmailCard({ currentEmail }: EmailCardProps) {
  const [newEmail, setNewEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    const outcome = await changeAccountEmail({ newEmail, password });
    setSubmitting(false);
    if (!outcome.ok) {
      toast.error(outcome.error);
      return;
    }
    // Long enough to read: it says what happens next.
    toast.success(`Check ${outcome.value.newEmail} for a link`, {
      description:
        "Open it to confirm the change. Until then you keep signing in with your current address. If nothing arrives within a few minutes, try again.",
      duration: 15_000,
    });
    setNewEmail("");
    setPassword("");
  }

  return (
    <section className="space-y-4 rounded-3xl border bg-card p-5 md:p-6">
      <div className="space-y-1">
        <h2 className="flex items-center gap-2 text-xl font-medium">
          <AtSignIcon className="size-5 text-muted-foreground" />
          Email address
        </h2>
        <p className="max-w-xl text-sm text-muted-foreground">
          You sign in with {currentEmail ? <strong className="text-foreground">{currentEmail}</strong> : "your address"}.
        </p>
      </div>
      <div>
        <form onSubmit={onSubmit} noValidate className="max-w-sm">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="account-new-email">New address</FieldLabel>
              <Input id="account-new-email" type="email" autoComplete="email" value={newEmail} onChange={(event) => setNewEmail(event.target.value)} />
              <FieldDescription>We send a link to it. Your address changes once you open that link.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="account-email-password">Password</FieldLabel>
              <Input id="account-email-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
            </Field>
            <Button type="submit" size="lg" className="w-fit rounded-full" disabled={submitting || !newEmail || !password}>
              {submitting ? "Sending…" : "Change address"}
            </Button>
          </FieldGroup>
        </form>
      </div>
    </section>
  );
}
