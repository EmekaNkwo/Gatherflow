"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { CheckIcon, PlusIcon, UserPlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/shared/select-field";
import { LinkButton } from "@/components/shared/link-button";
import { EmptyState } from "@/components/shared/empty-state";
import { PageShell, Section } from "@/components/shared/page-header";
import { MessageComposer } from "@/components/communications/message-composer";
import { CompleteTaskDialog } from "@/components/follow-ups/complete-task-dialog";
import { CreateTaskDialog } from "@/components/follow-ups/create-task-dialog";
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
import { useFollowUps, usePersonTasks, useTaskActionGate } from "@/hooks/useFollowUps";
import { useMemberJourney } from "@/hooks/useMemberJourney";
import { useMembers, usePerson } from "@/hooks/useMembers";
import { useNow } from "@/hooks/use-now";
import { usePersonAttendance } from "@/hooks/useAttendance";
import { usePersonCommunications } from "@/hooks/useCommunications";
import { useVisitor, useVisitorActionGate, useVisitors } from "@/hooks/useVisitors";
import { useSnapshot } from "@/hooks/use-church-data";

/** Refusals meaning the task changed elsewhere; the church is re-read, so close. */
const STALE_CODES = new Set(["closed", "not_found"]);

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

  const snapshot = useSnapshot();
  const { assignableTeam, can, canRun, teamMemberId } = useRole();
  const allows = useVisitorActionGate();
  const allowsTask = useTaskActionGate();
  const { assign, stopFollowUp, reopenFollowUp, updateContactPreferences, expressMembershipInterest } = useVisitors();
  const { complete, reschedule, create, scope } = useFollowUps();
  const { register: registerMember } = useMembers();
  const [planning, setPlanning] = useState(false);

  const [composing, setComposing] = useState(false);
  const [closing, setClosing] = useState(false);
  const [preferences, setPreferences] = useState(false);
  const [completing, setCompleting] = useState<TaskWithPerson | null>(null);
  const [rescheduling, setRescheduling] = useState<TaskWithPerson | null>(null);

  // A member who never had a visitor record belongs on the member page.
  const memberOnly = Boolean(person?.member && !person.visitor);
  useEffect(() => {
    if (memberOnly) router.replace(`/members/${personId}`);
  }, [memberOnly, personId, router]);

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
  const own = scope === "own";
  // Each control is gated by the command it dispatches, so nothing offered
  // here is refused by the server.
  const canPreferences = allows("preferences", person);
  const canAssign = allows("assign", person);
  const canPlan =
    Boolean(visitor) &&
    !person.contact.optedOut &&
    canRun("task.create", {
      personId: person.id,
      type: "say_hello",
      assigneeId: own ? (teamMemberId ?? undefined) : undefined,
    });
  const canMakeMember =
    !person.member && canRun("member.register", { personId: person.id, membershipDate: toIsoDate(now) });
  const canNoteInterest = allows("membership", person);
  const name = displayName(person);
  const firstName = name.split(" ")[0];
  const open = tasks.filter((entry) => entry.task.status !== "completed" && entry.task.status !== "cancelled");
  const finished = tasks.filter((entry) => entry.task.status === "completed" || entry.task.status === "cancelled");
  const visits = row?.visits ?? 0;

  const menu: PersonMenuItem[] = [
    ...(canPreferences ? [{ label: "How they like to be contacted", onSelect: () => setPreferences(true) }] : []),
    ...(allows("reopen", person)
      ? [{ label: "Reopen follow-up", onSelect: () => void reopenFollowUp(person.id) }]
      : []),
    ...(allows("stop", person)
      ? [{ label: "Stop following up", onSelect: () => setClosing(true), destructive: true }]
      : []),
  ];

  // A volunteer only sees their own follow-ups, so "nothing waiting" would
  // be untrue when somebody else is looking after this person.
  const keeper = visitor?.assignedTo && visitor.assignedTo !== teamMemberId ? row?.assigneeName : undefined;
  const emptyMessage =
    person.contact.optedOut || visitor?.closure
      ? "Follow-up has stopped for them, so nothing new will be set up."
      : own && keeper
        ? `${keeper} is looking after ${firstName}, so their follow-ups aren't on your list.`
        : own
          ? `Nothing is waiting for you with ${firstName} right now.`
          : `Nothing is waiting for ${firstName} right now.`;

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
          can("communications.write") && canRun("communication.log", {
            personId: person.id,
            channel: person.contact.preferredMethod,
            status: "drafted",
            body: "",
          }) && !person.contact.optedOut
            ? () => setComposing(true)
            : undefined
        }
        menu={menu}
      />

      <Section
        title={open.length ? (own ? "Waiting for you" : "Waiting for them") : "Nothing waiting"}
        actions={
          canPlan ? (
            <Button variant="outline" className="min-h-11 gap-1.5 rounded-full" onClick={() => setPlanning(true)}>
              <PlusIcon />
              Plan a follow-up
            </Button>
          ) : undefined
        }
      >
        <TaskList
          tasks={open}
          now={now}
          emptyMessage={emptyMessage}
          allows={allowsTask}
          onComplete={(task) => setCompleting(task)}
          onReschedule={(task) => setRescheduling(task)}
        />
      </Section>

      {canAssign ? (
        <Section title="Who's looking after them">
          <div className="space-y-3 rounded-3xl border bg-card p-5">
            <label htmlFor="visitor-assignee" className="sr-only">
              Who&apos;s looking after {firstName}
            </label>
            <SelectField
              id="visitor-assignee"
              value={visitor?.assignedTo ?? ""}
              onValueChange={(value) => assign(person.id, value || undefined)}
              options={[
                { value: "", label: "Nobody yet" },
                ...assignableTeam.map((member) => ({ value: member.id, label: member.name })),
              ]}
            />
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
          {!person.member && (canMakeMember || canNoteInterest) ? (
            <div className="flex flex-wrap gap-2 border-t pt-4">
              {canMakeMember ? (
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
              ) : null}
              {canNoteInterest ? (
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
              ) : null}
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
          {canPreferences ? (
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
        onConfirm={async (outcome: TaskOutcome, note?: string) => {
          if (!completing) return;
          // Stays open on a refusal so the answer isn't lost, unless the task
          // changed elsewhere; the page then shows it as it now is.
          const result = await complete(completing.task.id, outcome, note);
          if (result.ok || STALE_CODES.has(result.code ?? "")) setCompleting(null);
        }}
      />
      <CreateTaskDialog
        open={planning}
        onOpenChange={setPlanning}
        people={snapshot.people}
        team={assignableTeam}
        today={toIsoDate(now)}
        defaultDueInDays={snapshot.settings.defaultFollowUpDueInDays}
        personId={person.id}
        currentMemberId={teamMemberId ?? undefined}
        ownOnly={own}
        onConfirm={async (values) => {
          const outcome = await create(values);
          if (outcome.ok) setPlanning(false);
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
