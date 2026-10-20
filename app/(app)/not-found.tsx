import { CompassIcon } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { LinkButton } from "@/components/shared/link-button";
import { PageShell } from "@/components/shared/page-header";

/**
 * A page that doesn't exist, shown inside the app so the menu is still
 * there and there is an obvious way back.
 */
export default function AppNotFound() {
  return (
    <PageShell>
      <EmptyState
        icon={CompassIcon}
        title="We can't find that page"
        description="The link may be old or mistyped, or the record may have been removed. Everything else is where you left it."
        action={
          <LinkButton size="lg" className="rounded-full" href="/dashboard">
            Back to Today
          </LinkButton>
        }
      />
    </PageShell>
  );
}
