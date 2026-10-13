"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import {
  GraduationCapIcon,
  MessageSquareIcon,
  PhoneCallIcon,
  Trash2Icon,
  UsersRoundIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LinkButton } from "@/components/shared/link-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/empty-state";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { MembershipStatusBadge, OptedOutBadge, RestrictedBadge } from "@/components/shared/badges";
import { PageHeader, PageShell, Section } from "@/components/shared/page-header";
import { MessageComposer } from "@/components/communications/message-composer";
import { CompleteTaskDialog } from "@/components/follow-ups/complete-task-dialog";
import { RescheduleDialog } from "@/components/follow-ups/reschedule-dialog";
import { TaskList } from "@/components/follow-ups/task-list";
import { AddToGroupDialog, MembershipStatusDialog } from "@/components/members/member-dialogs";
import { JourneyTimeline } from "@/components/people/journey-timeline";
import {
  AttendanceHistoryPanel,
  CommunicationsPanel,
  TimelinePanel,
} from "@/components/people/person-panels";
import { formatDisplayDate, toIsoDate } from "@/lib/dates";
import { displayName, fullName } from "@/lib/strings";
import { CONTACT_METHOD_LABELS } from "@/types/common";
import type { TaskWithPerson } from "@/services/follow-ups/selectors";
import { attendanceHabit } from "@/services/analytics/attendance";
import { useDemoRole } from "@/hooks/useDemoRole";
import { useFollowUps, usePersonTasks } from "@/hooks/useFollowUps";
import { useGroups } from "@/hooks/useGroups";
import { useMember, useMembers, usePerson } from "@/hooks/useMembers";
import { useMemberJourney } from "@/hooks/useMemberJourney";
import { useNow } from "@/hooks/use-now";
import { usePersonAttendance } from "@/hooks/useAttendance";
import { usePersonCommunications } from "@/hooks/useCommunications";
import { usePersonCareRecords } from "@/hooks/usePastoralCare";
import { useSnapshot } from "@/hooks/use-church-data";

/** A member's record: engagement, journey, groups, tasks and timeline. */
export default function MemberProfilePage() {
  const params = useParams<{ id: string }>();
  const personId = params.id;
  const now = useNow();

  const snapshot = useSnapshot();
  const person = usePerson(personId);
  const row = useMember(personId);
  const journey = useMemberJourney(personId);
  const tasks = usePersonTasks(personId);
  const attendance = usePersonAttendance(personId);
  const communications = usePersonCommunications(personId);
  const careRecords = usePersonCareRecords(personId);

  const { can } = useDemoRole();
  const { changeStatus, completeOrientation, markRequestedContact, remove } = useMembers();
  const { addMember } = useGroups();
  const { complete, reschedule } = useFollowUps();

  const [composing, setComposing] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [completing, setCompleting] = useState<TaskWithPerson | null>(null);
  const [rescheduling, setRescheduling] = useState<TaskWithPerson | null>(null);

  if (!person?.member) {
    return (
      <PageShell>
        <EmptyState
          title="That member record no longer exists"
          description="It may have been deleted, or the person is still a visitor."
          action={
            <LinkButton size="sm" href="/members">
              Back to members
            </LinkButton>
          }
        />
      </PageShell>
    );
  }

  const member = person.member;
  const canEdit = can("people.write");
  const habit = attendanceHabit(snapshot, person, now);
  const groupNames = row?.groupNames ?? [];

  return (
    <PageShell>
      <PageHeader
        title={displayName(person)}
        description={`Member ${member.reference} · joined ${formatDisplayDate(member.membershipDate)}`}
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
            {canEdit ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => completeOrientation(person.id)}
                >
                  <GraduationCapIcon />
                  Record orientation
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => setGroupOpen(true)}
                >
                  <UsersRoundIcon />
                  Add to a group
                </Button>
                <Button size="sm" onClick={() => setStatusOpen(true)}>
                  Change status
                </Button>
              </>
            ) : null}
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <MembershipStatusBadge status={member.status} />
        {person.contact.optedOut ? <OptedOutBadge /> : null}
        {member.requestedContact ? <Badge variant="secondary">Asked to be contacted</Badge> : null}
        {person.visitor ? (
          <Badge variant="outline">
            First visited {formatDisplayDate(person.visitor.firstVisitDate)}
          </Badge>
        ) : null}
        {groupNames.map((name) => (
          <Badge key={name} variant="outline">
            {name}
          </Badge>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
            <CardDescription>
              Only what the church needs to stay in touch and to run its ministries.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Detail label="Full name" value={fullName(person)} />
            <Detail label="Member ID" value={member.reference} />
            <Detail label="Phone" value={person.phone} />
            <Detail label="Email" value={person.email} />
            <Detail label="Household" value={row?.householdName} />
            <Detail
              label="Preferred service"
              value={member.preferredServiceType?.replace(/_/g, " ")}
            />
            <Detail
              label="Contact"
              value={
                person.contact.optedOut
                  ? "Opted out"
                  : `${CONTACT_METHOD_LABELS[person.contact.preferredMethod]}${
                      person.contact.permissionGranted ? "" : " (no permission)"
                    }`
              }
            />
            {canEdit ? (
              <div className="flex flex-wrap gap-2 pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => markRequestedContact(person.id, !member.requestedContact)}
                >
                  <PhoneCallIcon />
                  {member.requestedContact ? "Clear contact request" : "Mark as asked for contact"}
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => setDeleting(true)}
                >
                  <Trash2Icon />
                  Delete record
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Engagement</CardTitle>
            <CardDescription>{habit.detail}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Detail label="Attendance" value={habit.label} />
            <Detail label="Last recorded" value={formatDisplayDate(row?.lastAttendance)} />
            <Detail
              label="Groups"
              value={groupNames.length ? groupNames.join(", ") : "Not in a group"}
            />
            <Detail label="Open follow-ups" value={String(row?.openTaskCount ?? 0)} />
            {row?.reviewReason ? (
              <p className="rounded-lg bg-muted/50 p-2 text-xs text-muted-foreground">
                {row.reviewReason} Nothing has been changed automatically.
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Journey</CardTitle>
            <CardDescription>
              What has happened, with dates. Optional milestones never block the ones after them.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <JourneyTimeline milestones={journey.milestones} />
          </CardContent>
        </Card>
      </div>

      {member.emergencyContact && can("care.read") ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Emergency contact
              <RestrictedBadge />
            </CardTitle>
            <CardDescription>
              Restricted: shown only to roles authorised for pastoral care, and never exported.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Detail label="Name" value={member.emergencyContact.name} />
            <Detail label="Relationship" value={member.emergencyContact.relationship} />
            <Detail label="Phone" value={member.emergencyContact.phone} />
          </CardContent>
        </Card>
      ) : null}

      {careRecords.length ? (
        <Section
          title="Pastoral care"
          description="Visible because this demo role is authorised. Notes stay in the care section."
        >
          <ul className="space-y-2">
            {careRecords.map(({ record }) => (
              <li
                key={record.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2 text-sm"
              >
                <span>
                  {record.reference} · {record.summary}
                </span>
                <LinkButton variant="outline" size="xs" href="/pastoral-care">
                  Open care record
                </LinkButton>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title="Follow-up tasks" description="Everything scheduled or completed.">
        <TaskList
          tasks={tasks}
          now={now}
          emptyMessage="No follow-up tasks for this member."
          onComplete={can("tasks.write") ? setCompleting : undefined}
          onReschedule={can("tasks.write") ? setRescheduling : undefined}
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

      <MembershipStatusDialog
        open={statusOpen}
        onOpenChange={setStatusOpen}
        personName={displayName(person)}
        current={member.status}
        onConfirm={(status, reason) => {
          changeStatus(person.id, status, reason);
          setStatusOpen(false);
        }}
      />

      <AddToGroupDialog
        open={groupOpen}
        onOpenChange={setGroupOpen}
        personName={displayName(person)}
        groups={snapshot.groups}
        onConfirm={(groupId) => {
          addMember(groupId, person.id);
          setGroupOpen(false);
        }}
      />

      <CompleteTaskDialog
        task={completing}
        onOpenChange={(open) => !open && setCompleting(null)}
        onConfirm={(outcome, note) => {
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

      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title="Delete this record?"
        description="The person, their attendance, tasks, messages and timeline are all removed. The audit entry left behind contains no personal details. This cannot be undone from here."
        confirmLabel="Delete permanently"
        destructive
        onConfirm={() => remove(person.id, "Deletion requested")}
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
