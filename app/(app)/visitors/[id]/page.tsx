"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  BanIcon,
  MessageSquareIcon,
  UserCheckIcon,
  UserPlusIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LinkButton } from "@/components/shared/link-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { EmptyState } from "@/components/shared/empty-state";
import { OptedOutBadge, StageBadge } from "@/components/shared/badges";
import { PageHeader, PageShell, Section } from "@/components/shared/page-header";
import { MessageComposer } from "@/components/communications/message-composer";
import { CompleteTaskDialog } from "@/components/follow-ups/complete-task-dialog";
import { RescheduleDialog } from "@/components/follow-ups/reschedule-dialog";
import { TaskList } from "@/components/follow-ups/task-list";
import { JourneyTimeline } from "@/components/people/journey-timeline";
import {
  AttendanceHistoryPanel,
  CommunicationsPanel,
  TimelinePanel,
} from "@/components/people/person-panels";
import {
  CloseFollowUpDialog,
  ContactPreferencesDialog,
} from "@/components/visitors/visitor-dialogs";
import { formatDisplayDate, toIsoDate } from "@/lib/dates";
import { displayName, fullName } from "@/lib/strings";
import { CONTACT_METHOD_LABELS } from "@/types/common";
import { CLOSURE_REASON_LABELS, VISITOR_SOURCE_LABELS } from "@/types/person";
import type { TaskWithPerson } from "@/services/follow-ups/selectors";
import type { TaskOutcome } from "@/types/follow-up";
import { useDemoRole } from "@/hooks/useDemoRole";
import { useFollowUps, usePersonTasks } from "@/hooks/useFollowUps";
import { useMemberJourney } from "@/hooks/useMemberJourney";
import { useMembers, usePerson } from "@/hooks/useMembers";
import { useNow } from "@/hooks/use-now";
import { usePersonAttendance } from "@/hooks/useAttendance";
import { usePersonCommunications } from "@/hooks/useCommunications";
import { useVisitor, useVisitors } from "@/hooks/useVisitors";

/** A visitor's record: journey, follow-up work, attendance and messages. */
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

  const { assignableTeam, can } = useDemoRole();
  const { assign, stopFollowUp, updateContactPreferences, expressMembershipInterest } =
    useVisitors();
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
          title="That record no longer exists"
          description="It may have been deleted. Go back to the visitor directory to find someone else."
          action={
            <LinkButton size="sm" href="/visitors">
              Back to visitors
            </LinkButton>
          }
        />
      </PageShell>
    );
  }

  const visitor = person.visitor;
  const canEdit = can("visitors.write") || can("people.write");

  return (
    <PageShell>
      <PageHeader
        title={displayName(person)}
        description={
          visitor
            ? `First visit ${formatDisplayDate(visitor.firstVisitDate)} · ${VISITOR_SOURCE_LABELS[visitor.source]} · ${row?.visits ?? 0} recorded visit${(row?.visits ?? 0) === 1 ? "" : "s"}`
            : "This person has no visitor record."
        }
        actions={
          <>
            {canEdit && !person.contact.optedOut ? (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => setComposing(true)}
              >
                <MessageSquareIcon />
                Prepare a message
              </Button>
            ) : null}
            {canEdit && !person.member ? (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => expressMembershipInterest(person.id)}
                disabled={Boolean(visitor?.membershipInterestAt)}
              >
                <UserCheckIcon />
                {visitor?.membershipInterestAt
                  ? "Membership interest recorded"
                  : "Record membership interest"}
              </Button>
            ) : null}
            {canEdit && !person.member ? (
              <Button
                size="sm"
                className="gap-1.5"
                onClick={async () => {
                  const outcome = await registerMember({
                    personId: person.id,
                    membershipDate: toIsoDate(now),
                  });
                  if (outcome.ok) router.push(`/members/${person.id}`);
                }}
              >
                <UserPlusIcon />
                Register as a member
              </Button>
            ) : null}
            {person.member ? (
              <LinkButton size="sm" href={`/members/${person.id}`}>
                Open member record
              </LinkButton>
            ) : null}
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        {row?.stage ? (
          <StageBadge name={row.statusLabel} terminal={row.stage.kind === "terminal"} />
        ) : null}
        {person.contact.optedOut ? <OptedOutBadge /> : null}
        {!person.contact.permissionGranted && !person.contact.optedOut ? (
          <Badge variant="outline">No contact permission</Badge>
        ) : null}
        {visitor?.closure ? (
          <Badge variant="outline">{CLOSURE_REASON_LABELS[visitor.closure.reason]}</Badge>
        ) : null}
        {person.member ? <Badge variant="default">Member {person.member.reference}</Badge> : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Contact</CardTitle>
            <CardDescription>
              {person.contact.optedOut
                ? "They asked not to be contacted. Nothing will be drafted or scheduled."
                : person.contact.permissionGranted
                  ? `Happy to be contacted · prefers ${CONTACT_METHOD_LABELS[person.contact.preferredMethod].toLowerCase()}`
                  : "No contact permission recorded."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Detail label="Full name" value={fullName(person)} />
            <Detail label="Phone" value={person.phone} />
            <Detail label="Email" value={person.email} />
            <Detail
              label="Last contacted"
              value={visitor?.lastContactAt ? formatDisplayDate(visitor.lastContactAt) : undefined}
            />
            <Detail label="Contact attempts" value={String(visitor?.contactAttempts ?? 0)} />
            <Detail
              label="Interests"
              value={person.interests.length ? person.interests.join(", ") : undefined}
            />
            {canEdit ? (
              <div className="flex flex-wrap gap-2 pt-2">
                <Button variant="outline" size="sm" onClick={() => setPreferences(true)}>
                  Contact preferences
                </Button>
                {!visitor?.closure ? (
                  <Button
                    variant="destructive"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => setClosing(true)}
                  >
                    <BanIcon />
                    Stop follow-up
                  </Button>
                ) : null}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Follow-up owner</CardTitle>
            <CardDescription>
              Every visitor should have one person responsible for the welcome.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm">
              {row?.assigneeName ?? "Nobody is assigned yet."}
            </p>
            {canEdit ? (
              <NativeSelect
                className="w-full"
                aria-label="Assign follow-up"
                value={visitor?.assignedTo ?? ""}
                onChange={(event) => assign(person.id, event.target.value || undefined)}
              >
                <NativeSelectOption value="">Unassigned</NativeSelectOption>
                {assignableTeam.map((member) => (
                  <NativeSelectOption key={member.id} value={member.id}>
                    {member.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            ) : null}
            {visitor?.notes ? (
              <p className="rounded-lg bg-muted/50 p-2 text-xs text-muted-foreground">
                {visitor.notes}
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Journey</CardTitle>
            <CardDescription>
              Dated milestones, not a score. Some are optional and never block the others.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <JourneyTimeline milestones={journey.milestones} />
          </CardContent>
        </Card>
      </div>

      <Section
        title="Follow-up tasks"
        description="Everything scheduled or completed for this person."
      >
        <TaskList
          tasks={tasks}
          now={now}
          emptyMessage="No follow-up tasks. If this person asked us to stop, that is expected."
          onComplete={can("tasks.write") ? (task) => setCompleting(task) : undefined}
          onReschedule={can("tasks.write") ? (task) => setRescheduling(task) : undefined}
          onMessage={
            can("communications.write") && !person.contact.optedOut
              ? () => setComposing(true)
              : undefined
          }
        />
      </Section>

      <div className="grid gap-4 lg:grid-cols-3">
        <AttendanceHistoryPanel entries={attendance} />
        <CommunicationsPanel entries={communications} />
        <TimelinePanel
          events={journey.timeline}
          now={now}
          restrictedHidden={journey.restrictedHidden}
        />
      </div>

      <MessageComposer
        person={composing ? person : null}
        onOpenChange={(open) => !open && setComposing(false)}
      />
      <CloseFollowUpDialog
        open={closing}
        onOpenChange={setClosing}
        personName={displayName(person)}
        onConfirm={(reason, note, optOut) => {
          stopFollowUp(person.id, reason, note, optOut);
          setClosing(false);
        }}
      />
      <ContactPreferencesDialog
        open={preferences}
        onOpenChange={setPreferences}
        personName={displayName(person)}
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

function Detail({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={value ? "text-right" : "text-right text-muted-foreground"}>
        {value ?? "—"}
      </span>
    </div>
  );
}
