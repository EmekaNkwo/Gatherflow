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
    <Empty className="rounded-3xl border border-dashed bg-card/50">
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

/** Shown when the signed-in role may not see a section. */
export function RestrictedState({ section }: { section: string }) {
  return (
    <EmptyState
      icon={LockIcon}
      title={`${section} is restricted`}
      description="Your role is not authorised to see this section. Ask an administrator if you need access."
    />
  );
}
