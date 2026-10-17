"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { CheckIcon, UserPlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { LinkButton } from "@/components/shared/link-button";
import { EmptyState } from "@/components/shared/empty-state";
import { PageShell, Section } from "@/components/shared/page-header";
import { MessageComposer } from "@/components/communications/message-composer";
import { CompleteTaskDialog } from "@/components/follow-ups/complete-task-dialog";
import { RescheduleDialog } from "@/components/follow-ups/reschedule-dialog";
import { TaskList } from "@/components/follow-ups/task-list";
import { plainStageName } from "@/components/follow-ups/pipeline-board";
import { JourneyTimeline } from "@/components/people/journey-timeline";
import { Chip, PersonHero, type PersonMenuItem } from "@/components/people/person-hero";
import {
  AttendanceHistoryPanel,
  CommunicationsPanel,
  DetailList,
  Disclosure,
  FinishedFollowUps,
  TimelinePanel,
} from "@/components/people/person-panels";
import { CloseFollowUpDialog, ContactPreferencesDialog } from "@/components/visitors/visitor-dialogs";
import { formatDisplayDate, toIsoDate } from "@/lib/dates";
import { displayName, fullName } from "@/lib/strings";
import { CONTACT_METHOD_LABELS } from "@/types/common";
import { CLOSURE_REASON_LABELS, VISITOR_SOURCE_LABELS } from "@/types/person";
import type { TaskWithPerson } from "@/services/follow-ups/selectors";
import type { TaskOutcome } from "@/types/follow-up";
import { useRole } from "@/hooks/useRole";
import { useFollowUps, usePersonTasks } from "@/hooks/useFollowUps";
import { useMemberJourney } from "@/hooks/useMemberJourney";
import { useMembers, usePerson } from "@/hooks/useMembers";
import { useNow } from "@/hooks/use-now";
import { usePersonAttendance } from "@/hooks/useAttendance";
import { usePersonCommunications } from "@/hooks/useCommunications";
import { useVisitor, useVisitors } from "@/hooks/useVisitors";

/**
 * A visitor, at a glance: who they are and how to reach them, what is
 * waiting for them, who is looking after them and where they are in their
 * journey. Details, history and the rarer changes sit behind disclosure.
 */
export default function VisitorProfilePage() {
  const params = useParams<{ id: string }>();
  const personId = params.id;
  const router = useRouter();
  const now = useNow();

  const person = usePerson(personId);
  const row = useVisitor(personId);
  const journey = useMemberJourney(personId);
  const tasks = usePersonTasks(personId);
  const attendance = usePersonAttendance(personId);
  const communications = usePersonCommunications(personId);

  const { assignableTeam, can } = useRole();
  const { assign, stopFollowUp, updateContactPreferences, expressMembershipInterest } = useVisitors();
  const { complete, reschedule } = useFollowUps();
  const { register: registerMember } = useMembers();

  const [composing, setComposing] = useState(false);
  const [closing, setClosing] = useState(false);
  const [preferences, setPreferences] = useState(false);
  const [completing, setCompleting] = useState<TaskWithPerson | null>(null);
  const [rescheduling, setRescheduling] = useState<TaskWithPerson | null>(null);

  if (!person) {
    return (
      <PageShell>
        <EmptyState
          title="We can't find that person"
          description="Their record may have been removed. Have a look in Visitors for someone else."
          action={
            <LinkButton size="lg" className="rounded-full" href="/visitors">
              Back to visitors
            </LinkButton>
          }
        />
      </PageShell>
    );
  }

  const visitor = person.visitor;
  const canEdit = can("visitors.write") || can("people.write");
  const name = displayName(person);
  const firstName = name.split(" ")[0];
  const open = tasks.filter((entry) => entry.task.status !== "completed" && entry.task.status !== "cancelled");
  const finished = tasks.filter((entry) => entry.task.status === "completed" || entry.task.status === "cancelled");
  const visits = row?.visits ?? 0;

  const menu: PersonMenuItem[] = canEdit
    ? [
        { label: "How they like to be contacted", onSelect: () => setPreferences(true) },
        ...(!visitor?.closure
          ? [{ label: "Stop following up", onSelect: () => setClosing(true), destructive: true }]
          : []),
      ]
    : [];

  return (
    <PageShell className="max-w-4xl space-y-10">
      <PersonHero
        person={person}
        eyebrow={
          visitor
            ? `Visitor · first came ${formatDisplayDate(visitor.firstVisitDate)}`
            : person.member
              ? "Member"
              : "Visitor"
        }
        summary={
          visitor
            ? `${visits === 0 ? "No visits recorded yet" : visits === 1 ? "Been once" : `Been ${visits} times`}. ${
                row?.assigneeName ? `${row.assigneeName} is looking after them.` : "Nobody is looking after them yet."
              }`
            : "There's no visitor record for them."
        }
        chips={
          <>
            {row?.stage ? (
              <Chip tone={row.stage.kind === "terminal" ? "muted" : "accent"}>
                {row.statusLabel === row.stage.name ? plainStageName(row.stage) : row.statusLabel}
              </Chip>
            ) : null}
            {person.contact.optedOut ? <Chip tone="warning">Do not contact</Chip> : null}
            {visitor?.closure ? <Chip>{CLOSURE_REASON_LABELS[visitor.closure.reason]}</Chip> : null}
            {visitor?.membershipInterestAt && !person.member ? (
              <Chip tone="done">Interested in membership</Chip>
            ) : null}
            {person.member ? <Chip tone="done">Member</Chip> : null}
          </>
        }
        onMessage={
          can("communications.write") && !person.contact.optedOut ? () => setComposing(true) : undefined
        }
        menu={menu}
      />

      <Section title={open.length ? "Waiting for them" : "Nothing waiting"}>
        <TaskList
          tasks={open}
          now={now}
          emptyMessage={
            person.contact.optedOut || visitor?.closure
              ? "Follow-up has stopped for them, so nothing new will be set up."
              : `Nothing is waiting for ${firstName} right now.`
          }
          onComplete={can("tasks.write") ? (task) => setCompleting(task) : undefined}
          onReschedule={can("tasks.write") ? (task) => setRescheduling(task) : undefined}
        />
      </Section>

      {canEdit ? (
        <Section title="Who's looking after them">
          <div className="space-y-3 rounded-3xl border bg-card p-5">
            <label htmlFor="visitor-assignee" className="sr-only">
              Who&apos;s looking after {firstName}
            </label>
            <NativeSelect
              id="visitor-assignee"
              className="w-full"
              value={visitor?.assignedTo ?? ""}
              onChange={(event) => assign(person.id, event.target.value || undefined)}
            >
              <NativeSelectOption value="">Nobody yet</NativeSelectOption>
              {assignableTeam.map((member) => (
                <NativeSelectOption key={member.id} value={member.id}>
                  {member.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <p className="text-sm text-muted-foreground">Anything still waiting for them goes to this person too.</p>
            {visitor?.notes ? (
              <p className="rounded-2xl bg-muted px-4 py-3 text-sm">{visitor.notes}</p>
            ) : null}
          </div>
        </Section>
      ) : visitor?.notes ? (
        <p className="rounded-2xl bg-muted px-4 py-3 text-sm">{visitor.notes}</p>
      ) : null}

      <Section title="Their journey">
        <div className="space-y-5 rounded-3xl border bg-card p-5">
          <JourneyTimeline milestones={journey.milestones} />
          {canEdit && !person.member ? (
            <div className="flex flex-wrap gap-2 border-t pt-4">
              <Button
                variant="outline"
                size="lg"
                className="rounded-full"
                onClick={async () => {
                  const outcome = await registerMember({ personId: person.id, membershipDate: toIsoDate(now) });
                  if (outcome.ok) router.push(`/members/${person.id}`);
                }}
              >
                <UserPlusIcon />
                Make them a member
              </Button>
              <Button
                variant="ghost"
                size="lg"
                className="rounded-full"
                onClick={() => expressMembershipInterest(person.id)}
                disabled={Boolean(visitor?.membershipInterestAt)}
              >
                {visitor?.membershipInterestAt ? <CheckIcon /> : null}
                {visitor?.membershipInterestAt ? "Interest in membership noted" : "They'd like to become a member"}
              </Button>
            </div>
          ) : null}
          {person.member ? (
            <div className="border-t pt-4">
              <LinkButton variant="outline" size="lg" className="rounded-full" href={`/members/${person.id}`}>
                Open their member page
              </LinkButton>
            </div>
          ) : null}
        </div>
      </Section>

      <FinishedFollowUps tasks={finished} />
      <CommunicationsPanel entries={communications} />

      <div className="space-y-3">
        <Disclosure title="Their details" summary={[person.phone, person.email].filter(Boolean).join(" · ") || "No phone or email yet"}>
          <DetailList
            rows={[
              { label: "Full name", value: fullName(person) },
              { label: "Phone", value: person.phone },
              { label: "Email", value: person.email },
              {
                label: "Getting in touch",
                value: person.contact.optedOut
                  ? "Asked not to be contacted"
                  : person.contact.permissionGranted
                    ? `Happy to hear from us, prefers ${CONTACT_METHOD_LABELS[person.contact.preferredMethod].toLowerCase()}`
                    : "Hasn't agreed to be contacted",
              },
              { label: "How they found us", value: visitor ? VISITOR_SOURCE_LABELS[visitor.source] : undefined },
              {
                label: "Last spoken to",
                value: visitor?.lastContactAt ? formatDisplayDate(visitor.lastContactAt) : undefined,
              },
              { label: "Times we've tried", value: String(visitor?.contactAttempts ?? 0) },
              { label: "Interests", value: person.interests.length ? person.interests.join(", ") : undefined },
            ]}
          />
          {canEdit ? (
            <Button variant="outline" size="lg" className="mt-4 rounded-full" onClick={() => setPreferences(true)}>
              Change how they like to be contacted
            </Button>
          ) : null}
        </Disclosure>
        <AttendanceHistoryPanel entries={attendance} />
        <TimelinePanel events={journey.timeline} now={now} restrictedHidden={journey.restrictedHidden} />
      </div>

      <MessageComposer person={composing ? person : null} onOpenChange={(open) => !open && setComposing(false)} />
      <CloseFollowUpDialog
        open={closing}
        onOpenChange={setClosing}
        personName={name}
        onConfirm={(reason, note, optOut) => {
          stopFollowUp(person.id, reason, note, optOut);
          setClosing(false);
        }}
      />
      <ContactPreferencesDialog
        open={preferences}
        onOpenChange={setPreferences}
        personName={name}
        initial={{
          preferredMethod: person.contact.preferredMethod,
          permissionGranted: person.contact.permissionGranted,
          optedOut: person.contact.optedOut,
        }}
        onConfirm={(changes) => {
          updateContactPreferences(person.id, changes);
          setPreferences(false);
        }}
      />
      <CompleteTaskDialog
        task={completing}
        onOpenChange={(open) => !open && setCompleting(null)}
        onConfirm={(outcome: TaskOutcome, note?: string) => {
          if (completing) complete(completing.task.id, outcome, note);
          setCompleting(null);
        }}
      />
      <RescheduleDialog
        task={rescheduling}
        today={toIsoDate(now)}
        onOpenChange={(open) => !open && setRescheduling(null)}
        onConfirm={(dueDate, reason) => {
          if (rescheduling) reschedule(rescheduling.task.id, dueDate, reason);
          setRescheduling(null);
        }}
      />
    </PageShell>
  );
}
