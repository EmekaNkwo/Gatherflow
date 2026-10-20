"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { DeleteAccountCard } from "@/components/account/delete-account-card";
import { EmailCard } from "@/components/account/email-card";
import { PasswordCard } from "@/components/account/password-card";
import { RemindersCard } from "@/components/account/reminders-card";
import { PageHeader, PageShell } from "@/components/shared/page-header";
import { authClient } from "@/lib/auth-client";

/**
 * The signed-in person's own account, whatever their role in the church:
 * the address and password they sign in with, reminders on this browser,
 * and leaving.
 */
export default function AccountPage() {
  const { data } = authClient.useSession();
  const params = useSearchParams();
  const notice = params.get("account");

  // Better Auth returns here after the confirmation link is opened.
  useEffect(() => {
    if (notice === "email-confirmed") toast.success("Your email address has been changed.");
  }, [notice]);

  return (
    <PageShell className="max-w-3xl space-y-6">
      <PageHeader title="Your account" description="How you sign in to GatherFlow. This is about you, not your church." />
      <EmailCard currentEmail={data?.user.email ?? null} />
      <PasswordCard />
      <RemindersCard />
      <DeleteAccountCard />
    </PageShell>
  );
}
