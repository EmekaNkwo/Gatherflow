import type { ReactNode } from "react";
import { InboxIcon, LockIcon, SearchXIcon, type LucideIcon } from "lucide-react";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

interface EmptyStateProps {
  title: string;
  description: string;
  icon?: LucideIcon;
  action?: ReactNode;
}

/** Shown when a list has no records at all. */
export function EmptyState({ title, description, icon: Icon = InboxIcon, action }: EmptyStateProps) {
  return (
    <Empty className="rounded-xl border border-dashed">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {action ? <EmptyContent>{action}</EmptyContent> : null}
    </Empty>
  );
}

/** Shown when filters or a search exclude everything. */
export function NoResultsState({
  onClear,
  context = "records",
}: {
  onClear?: ReactNode;
  context?: string;
}) {
  return (
    <EmptyState
      icon={SearchXIcon}
      title={`No ${context} match these filters`}
      description="Try a different search, or clear the filters to see everything again."
      action={onClear}
    />
  );
}

/** Shown when the active demo role may not see a section. */
export function RestrictedState({ section }: { section: string }) {
  return (
    <EmptyState
      icon={LockIcon}
      title={`${section} is restricted`}
      description="The demo role you are using is not authorised to see this section. Switch role in the header to view it as a pastor or administrator. In a real deployment this would be enforced by the server."
    />
  );
}
