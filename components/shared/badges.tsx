import { BanIcon, LockIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "cn";
import {
  TASK_PRIORITY_LABELS,
  TASK_STATUS_LABELS,
  type TaskPriority,
  type TaskStatus,
} from "@/types/follow-up";
import { MEMBERSHIP_STATUS_LABELS, type MembershipStatus } from "@/types/person";
import { CARE_STATUS_LABELS, type CareStatus } from "@/types/care";

type Variant = "default" | "secondary" | "destructive" | "outline" | "ghost";

const TASK_STATUS_VARIANTS: Record<TaskStatus, Variant> = {
  pending: "secondary",
  in_progress: "default",
  completed: "outline",
  rescheduled: "secondary",
  cancelled: "outline",
};

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  return <Badge variant={TASK_STATUS_VARIANTS[status]}>{TASK_STATUS_LABELS[status]}</Badge>;
}

const PRIORITY_VARIANTS: Record<TaskPriority, Variant> = {
  normal: "outline",
  high: "secondary",
  urgent: "destructive",
};

export function PriorityBadge({ priority }: { priority: TaskPriority }) {
  if (priority === "normal") return null;
  return <Badge variant={PRIORITY_VARIANTS[priority]}>{TASK_PRIORITY_LABELS[priority]}</Badge>;
}

const MEMBERSHIP_VARIANTS: Record<MembershipStatus, Variant> = {
  active: "secondary",
  new_member: "default",
  inactive: "outline",
  transferred: "outline",
  archived: "outline",
};

export function MembershipStatusBadge({ status }: { status: MembershipStatus }) {
  return (
    <Badge variant={MEMBERSHIP_VARIANTS[status]}>{MEMBERSHIP_STATUS_LABELS[status]}</Badge>
  );
}

const CARE_VARIANTS: Record<CareStatus, Variant> = {
  new: "default",
  assigned: "secondary",
  in_progress: "secondary",
  awaiting_response: "outline",
  resolved: "outline",
  closed: "outline",
};

export function CareStatusBadge({ status }: { status: CareStatus }) {
  return <Badge variant={CARE_VARIANTS[status]}>{CARE_STATUS_LABELS[status]}</Badge>;
}

/** Pipeline stage chip, muted for terminal stages. */
export function StageBadge({ name, terminal }: { name: string; terminal?: boolean }) {
  return <Badge variant={terminal ? "outline" : "secondary"}>{name}</Badge>;
}

export function OverdueBadge({ days }: { days?: number }) {
  return (
    <Badge variant="destructive">
      {days && days > 0 ? `${days} days overdue` : "Overdue"}
    </Badge>
  );
}

/** Marks information restricted to authorised roles. */
export function RestrictedBadge({ className }: { className?: string }) {
  return (
    <Badge variant="outline" className={cn("gap-1", className)}>
      <LockIcon />
      Restricted
    </Badge>
  );
}

/** Shown wherever an opted-out person appears, so nobody contacts them. */
export function OptedOutBadge({ className }: { className?: string }) {
  return (
    <Badge variant="destructive" className={cn("gap-1", className)}>
      <BanIcon />
      Do not contact
    </Badge>
  );
}
