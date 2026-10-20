"use client";

import { useState } from "react";
import { UserXIcon } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { deleteAccount } from "@/services/commands/client";

/**
 * Deleting the account. The church keeps the records; the person keeps
 * nothing that lets them sign in. Refused, with the reason, while they are
 * the only administrator of a church.
 */
export function DeleteAccountCard() {
  const [password, setPassword] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function onConfirm() {
    setConfirming(false);
    setSubmitting(true);
    const outcome = await deleteAccount(password);
    setSubmitting(false);
    if (!outcome.ok) {
      toast.error(outcome.error);
      return;
    }
    // A full load, so nothing of the account stays in memory.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/");
  }

  return (
    <section className="space-y-4 rounded-3xl border border-destructive/40 bg-card p-5 md:p-6">
      <div className="space-y-1">
        <h2 className="flex items-center gap-2 text-xl font-medium">
          <UserXIcon className="size-5 text-muted-foreground" />
          Delete your account
        </h2>
        <p className="max-w-xl text-sm text-muted-foreground">
          You will no longer be able to sign in. Your churches keep their records, and the work you did stays
          attributed to your name.
        </p>
      </div>
      <div className="max-w-sm space-y-3">
        <Field>
          <FieldLabel htmlFor="account-delete-password">Password</FieldLabel>
          <Input id="account-delete-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
          <FieldDescription>
            If you are the only administrator of a church, make somebody else an administrator first.
          </FieldDescription>
        </Field>
        <Button variant="destructive" size="lg" className="w-fit rounded-full" disabled={submitting || !password} onClick={() => setConfirming(true)}>
          {submitting ? "Deleting…" : "Delete account"}
        </Button>
        <ConfirmDialog
          open={confirming}
          onOpenChange={setConfirming}
          title="Delete your account?"
          description="This cannot be undone. You will be signed out everywhere."
          confirmLabel="Delete account"
          destructive
          onConfirm={() => void onConfirm()}
        />
      </div>
    </section>
  );
}
