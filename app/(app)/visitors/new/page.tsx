"use client";

import { LinkButton } from "@/components/shared/link-button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader, PageShell } from "@/components/shared/page-header";
import { RestrictedState } from "@/components/shared/empty-state";
import { VisitorForm } from "@/components/visitors/visitor-form";
import { useDemoRole } from "@/hooks/useDemoRole";

/** Full visitor registration, used when there is time to take more detail. */
export default function NewVisitorPage() {
  const { can } = useDemoRole();

  if (!can("visitors.write")) {
    return (
      <PageShell>
        <RestrictedState section="Visitor registration" />
      </PageShell>
    );
  }

  return (
    <PageShell className="max-w-3xl">
      <PageHeader
        title="Register a visitor"
        description="Only a name is required. Anything else can be added later — nobody should have to hand over their details to be welcomed."
        actions={
          <LinkButton variant="outline" size="sm" href="/visitors/quick">
            Switch to quick registration
          </LinkButton>
        }
      />
      <Card>
        <CardContent>
          <VisitorForm />
        </CardContent>
      </Card>
    </PageShell>
  );
}
