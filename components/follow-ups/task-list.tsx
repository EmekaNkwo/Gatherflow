"use client";

import Link from "next/link";
import {
  CalendarClockIcon,
  CheckIcon,
  EllipsisIcon,
  MailIcon,
  MessageCircleIcon,
  MessageSquareIcon,
  PhoneIcon,
} from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { format } from "date-fns";
import { daysBetween, parseDate, toIsoDate } from "@/lib/dates";
import { displayName } from "@/lib/strings";
import { contactOptions, type ContactLink } from "@/services/follow-ups/contact";
import type { TaskWithPerson } from "@/services/follow-ups/selectors";
import { TASK_OUTCOME_LABELS, type FollowUpTaskType } from "@/types/follow-up";
import { personHref } from "@/components/shared/person-cell";

/** What can be done to a follow-up from a card or a table row. */
export type TaskAction = "complete" | "reschedule" | "assign" | "cancel" | "message";

/**
 * Whether this person may do that to this follow-up — `useRole().canRun`
 * underneath, so a control is shown exactly when the server would accept it.
 */
export type TaskActionGate = (action: TaskAction, entry: TaskWithPerson) => boolean;

interface TaskListProps {
  tasks: readonly TaskWithPerson[];
  now: Date;
  emptyMessage: string;
  onComplete?: (task: TaskWithPerson) => void;
  onReschedule?: (task: TaskWithPerson) => void;
  onMessage?: (task: TaskWithPerson) => void;
  /** Staff: give the follow-up to somebody else. */
  onAssign?: (task: TaskWithPerson) => void;
  /** Staff: stop this follow-up without an outcome. */
  onCancel?: (task: TaskWithPerson) => void;
  limit?: number;
  /** Show who the task belongs to — for staff looking at everybody's work. */
  showAssignee?: boolean;
  /** Per-task check; without it every handler given is offered. */
  allows?: TaskActionGate;
}

/** What to do, said the way a person would say it. */
const WHAT_TO_DO: Record<FollowUpTaskType, string> = {
  welcome_message: "Send a welcome message",
  phone_call: "Give them a call",
  check_in: "Check in with them",
  service_invitation: "Invite them to a service",
  group_invitation: "Invite them to a group",
  membership_orientation: "Talk about membership",
  pastoral_contact: "Pastoral contact",
  post_event_follow_up: "Follow up after the event",
  say_hello: "Say hello in person",
};

const CONTACT_ICONS = {
  phone: PhoneIcon,
  sms: MessageSquareIcon,
  whatsapp: MessageCircleIcon,
  email: MailIcon,
  in_person: PhoneIcon,
} as const;

/** "Today", "Tomorrow", "Waiting 3 days", "Fri 18 Oct". */
function whenLabel(dueDate: string, now: Date): string {
  const days = daysBetween(toIsoDate(now), dueDate);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days < 0) return `Waiting ${-days} day${days === -1 ? "" : "s"}`;
  return format(parseDate(dueDate), "EEE d MMM");
}

/**
 * Follow-ups as people, not rows: who, what to do in plain words, how to
 * reach them in one tap, and a large "Done" that records what happened.
 */
export function TaskList({
  tasks,
  now,
  emptyMessage,
  onComplete,
  onReschedule,
  onMessage,
  onAssign,
  onCancel,
  limit,
  showAssignee = false,
  allows,
}: TaskListProps) {
  const visible = limit ? tasks.slice(0, limit) : tasks;

  if (!visible.length) {
    return <p className="rounded-2xl bg-muted px-5 py-6 text-muted-foreground">{emptyMessage}</p>;
  }

  return (
    <ul className="grid gap-3 lg:grid-cols-2">
      {visible.map((entry) => (
        <li key={entry.task.id}>
          <FollowUpCard
            entry={entry}
            now={now}
            showAssignee={showAssignee}
            onComplete={gated(onComplete, "complete", entry, allows)}
            onReschedule={gated(onReschedule, "reschedule", entry, allows)}
            onMessage={gated(onMessage, "message", entry, allows)}
            onAssign={gated(onAssign, "assign", entry, allows)}
            onCancel={gated(onCancel, "cancel", entry, allows)}
          />
        </li>
      ))}
    </ul>
  );
}

function gated(
  handler: ((task: TaskWithPerson) => void) | undefined,
  action: TaskAction,
  entry: TaskWithPerson,
  allows: TaskActionGate | undefined,
): ((task: TaskWithPerson) => void) | undefined {
  if (!handler) return undefined;
  return !allows || allows(action, entry) ? handler : undefined;
}

/** "Grace Mensah", "Tunde Balogun (no longer active)" or "nobody yet". */
export function ownerLabel(entry: TaskWithPerson): string {
  if (!entry.task.assigneeId) return "nobody yet";
  if (entry.ownerInactive) return `${entry.assigneeName ?? "someone"} (no longer active)`;
  return entry.assigneeName ?? "nobody yet";
}

function FollowUpCard({
  entry,
  now,
  showAssignee,
  onComplete,
  onReschedule,
  onMessage,
  onAssign,
  onCancel,
}: {
  entry: TaskWithPerson;
  now: Date;
  showAssignee: boolean;
  onComplete?: (task: TaskWithPerson) => void;
  onReschedule?: (task: TaskWithPerson) => void;
  onMessage?: (task: TaskWithPerson) => void;
  onAssign?: (task: TaskWithPerson) => void;
  onCancel?: (task: TaskWithPerson) => void;
}) {
  const { task, person } = entry;
  const name = person ? displayName(person) : "Somebody no longer on record";
  const finished = task.status === "completed" || task.status === "cancelled";
  // Finished work is history: how it ended, and no way to reach out from here.
  // A hello in person needs no phone number and no permission.
  const contact = person && !finished && task.type !== "say_hello" ? contactOptions(person) : null;
  const when = finished
    ? task.status === "cancelled"
      ? "Stopped"
      : task.outcome
        ? TASK_OUTCOME_LABELS[task.outcome]
        : "Done"
    : whenLabel(task.dueDate, now);

  return (
    <article
      aria-label={`${WHAT_TO_DO[task.type]} — ${name}`}
      className="flex h-full flex-col gap-4 rounded-3xl border bg-card p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          {person ? (
            <Link href={personHref(person)} className="block truncate text-lg font-semibold hover:underline">
              {name}
            </Link>
          ) : (
            <p className="truncate text-lg font-semibold">{name}</p>
          )}
          <p className="text-muted-foreground">
            {WHAT_TO_DO[task.type]}
            {showAssignee ? ` · ${ownerLabel(entry)}` : ""}
          </p>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full px-3 py-1 text-sm font-medium",
            entry.overdue && !finished
              ? "bg-primary/12 text-primary dark:text-foreground"
              : "bg-muted text-muted-foreground",
          )}
        >
          {when}
        </span>
      </div>

      {contact?.kind === "ok" ? (
        <div className="flex flex-wrap gap-2">
          {contact.links.map((link) => (
            <ContactButton key={link.method} link={link} name={name} />
          ))}
          {onMessage ? (
            <Button
              variant="outline"
              className="min-h-11 rounded-full"
              onClick={() => onMessage(entry)}
              aria-label={`Write a message to ${name}`}
            >
              <MessageSquareIcon />
              Message
            </Button>
          ) : null}
        </div>
      ) : contact ? (
        <p className="text-sm text-muted-foreground">{contact.reason}</p>
      ) : task.type === "say_hello" && !finished ? (
        <p className="text-sm text-muted-foreground">Look out for them at the next service. No messages.</p>
      ) : null}

      {finished && task.outcomeNote ? <p className="text-sm text-muted-foreground">“{task.outcomeNote}”</p> : null}

      {!finished && (onComplete || onReschedule || onAssign || onCancel) ? (
        <div className="mt-auto flex items-center gap-2">
          {onComplete ? (
            <Button
              size="lg"
              className="flex-1 rounded-full bg-done text-done-foreground hover:bg-done/90"
              onClick={() => onComplete(entry)}
              aria-label={`Done: record what happened with ${name}`}
            >
              <CheckIcon />
              Done
            </Button>
          ) : null}
          {onReschedule ? (
            <Button
              size="lg"
              variant="ghost"
              className="rounded-full"
              onClick={() => onReschedule(entry)}
              aria-label={`Do it later: move ${name}'s follow-up to another day`}
            >
              <CalendarClockIcon />
              Later
            </Button>
          ) : null}
          {onAssign || onCancel ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button size="icon-lg" variant="ghost" className="rounded-full" aria-label={`More for ${name}`}>
                    <EllipsisIcon />
                  </Button>
                }
              />
              <DropdownMenuContent align="end">
                {onAssign ? (
                  <DropdownMenuItem className="min-h-11" onClick={() => onAssign(entry)}>
                    Give to someone else
                  </DropdownMenuItem>
                ) : null}
                {onCancel ? (
                  <DropdownMenuItem className="min-h-11" variant="destructive" onClick={() => onCancel(entry)}>
                    Stop this follow-up
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function ContactButton({ link, name }: { link: ContactLink; name: string }) {
  const Icon = CONTACT_ICONS[link.method];
  const external = link.href.startsWith("http");
  return (
    <a
      href={link.href}
      target={external ? "_blank" : undefined}
      rel={external ? "noreferrer" : undefined}
      aria-label={`${link.label} ${name}`}
      className="inline-flex min-h-11 items-center gap-2 rounded-full border bg-background px-4 text-sm font-medium hover:bg-muted"
    >
      <Icon className="size-4" />
      {link.label}
    </a>
  );
}
