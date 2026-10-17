"use client";

import { useState, type FormEvent } from "react";
import { KeyRoundIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";

/** The signed-in account's password. */
export function PasswordCard() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    const outcome = await authClient.changePassword({
      currentPassword: current,
      newPassword: next,
      revokeOtherSessions: true,
    });
    setSubmitting(false);
    if (outcome.error) {
      toast.error(outcome.error.message ?? "The password could not be changed.");
      return;
    }
    setCurrent("");
    setNext("");
    toast.success("Password changed", { description: "Other devices have been signed out." });
  }

  return (
    <section className="space-y-4 rounded-3xl border bg-card p-5 md:p-6">
      <div className="space-y-1">
        <h2 className="flex items-center gap-2 text-xl font-medium">
          <KeyRoundIcon className="size-5 text-muted-foreground" />
          Password
        </h2>
        <p className="max-w-xl text-sm text-muted-foreground">Changing it signs out every other device.</p>
      </div>
      <div>
        <form onSubmit={onSubmit} noValidate className="max-w-sm">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="account-current">Current password</FieldLabel>
              <Input id="account-current" type="password" autoComplete="current-password" value={current} onChange={(event) => setCurrent(event.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="account-next">New password</FieldLabel>
              <Input id="account-next" type="password" autoComplete="new-password" minLength={12} value={next} onChange={(event) => setNext(event.target.value)} />
              <FieldDescription>At least 12 characters.</FieldDescription>
            </Field>
            <Button type="submit" size="lg" className="w-fit rounded-full" disabled={submitting || !current || next.length < 12}>
              {submitting ? "Saving…" : "Change password"}
            </Button>
          </FieldGroup>
        </form>
      </div>
    </section>
  );
}
