"use client";

import Link from "next/link";
import { PageHeader, PageShell } from "@/components/shared/page-header";
import { RestrictedState } from "@/components/shared/empty-state";
import { VisitorForm } from "@/components/visitors/visitor-form";
import { useRole } from "@/hooks/useRole";

/** Adding a visitor when there is time to take a little more. */
export default function NewVisitorPage() {
  const { can } = useRole();

  if (!can("visitors.write")) {
    return (
      <PageShell>
        <RestrictedState section="Visitor registration" />
      </PageShell>
    );
  }

  return (
    <PageShell className="max-w-2xl">
      <PageHeader
        title="Add a visitor"
        description="A name is enough to start. Nobody has to hand over their details to be welcomed."
      />
      <VisitorForm />
      <p className="text-sm text-muted-foreground">
        At the welcome desk with a queue?{" "}
        <Link href="/visitors/quick" className="font-medium text-primary underline-offset-4 hover:underline">
          Use the quick welcome
        </Link>
        .
      </p>
    </PageShell>
  );
}
