"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowRightIcon, PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LinkButton } from "@/components/shared/link-button";
import { EmptyState } from "@/components/shared/empty-state";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { RestrictedBadge } from "@/components/shared/badges";
import { PageShell, Section } from "@/components/shared/page-header";
import { MessageComposer } from "@/components/communications/message-composer";
import { CompleteTaskDialog } from "@/components/follow-ups/complete-task-dialog";
import { RescheduleDialog } from "@/components/follow-ups/reschedule-dialog";
import { TaskList } from "@/components/follow-ups/task-list";
import { AddToGroupDialog, MembershipStatusDialog } from "@/components/members/member-dialogs";
import { EditMemberDialog } from "@/components/members/edit-member-dialog";
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
import { formatDisplayDate, toIsoDate } from "@/lib/dates";
import { displayName, fullName } from "@/lib/strings";
import { CONTACT_METHOD_LABELS } from "@/types/common";
import { MEMBERSHIP_STATUS_LABELS } from "@/types/person";
import type { TaskWithPerson } from "@/services/follow-ups/selectors";
import { attendanceHabit } from "@/services/analytics/attendance";
import { canJoinGroups } from "@/services/groups/groups";
import { useRole } from "@/hooks/useRole";
import { useFollowUps, usePersonTasks } from "@/hooks/useFollowUps";
import { useGroups } from "@/hooks/useGroups";
import { useMember, useMembers, usePerson } from "@/hooks/useMembers";
import { useMemberJourney } from "@/hooks/useMemberJourney";
import { useNow } from "@/hooks/use-now";
import { usePersonAttendance } from "@/hooks/useAttendance";
import { usePersonCommunications } from "@/hooks/useCommunications";
import { usePersonCareRecords } from "@/hooks/usePastoralCare";
import { useSnapshot } from "@/hooks/use-church-data";

/**
 * A member, at a glance: who they are and how to reach them, what is waiting
 * for them, how they are getting on, and their journey. Status changes,
 * groups, details and history sit behind clear secondary actions.
 */
export default function MemberProfilePage() {
  const params = useParams<{ id: string }>();
  const personId = params.id;
  const now = useNow();
  const router = useRouter();

  const snapshot = useSnapshot();
  const person = usePerson(personId);
  const row = useMember(personId);
  const journey = useMemberJourney(personId);
  const tasks = usePersonTasks(personId);
  const attendance = usePersonAttendance(personId);
  const communications = usePersonCommunications(personId);
  const careRecords = usePersonCareRecords(personId);

  const { can, canRun } = useRole();
  const { changeStatus, completeOrientation, correct, markRequestedContact, remove } = useMembers();
  const { addMember } = useGroups();
  const { complete, reschedule } = useFollowUps();

  const [composing, setComposing] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [completing, setCompleting] = useState<TaskWithPerson | null>(null);
  const [rescheduling, setRescheduling] = useState<TaskWithPerson | null>(null);

  if (!person?.member) {
    return (
      <PageShell>
        <EmptyState
          title="We can't find that member"
          description="Their record may have been removed, or they're still a visitor."
          action={
            <LinkButton size="lg" className="rounded-full" href="/members">
              Back to members
            </LinkButton>
          }
        />
      </PageShell>
    );
  }

  const member = person.member;
  // Each control is offered exactly when the server would accept its command.
  const canChangeStatus = canRun("member.changeStatus", { personId: person.id, status: member.status });
  const canCorrect = canRun("person.correct", { personId: person.id, changes: {} });
  const canDelete = canRun("person.delete", { personId: person.id });
  const canNoteOrientation = canRun("member.recordOrientationCompleted", { personId: person.id });
  const canMarkContact = canRun("member.setRequestedContact", { personId: person.id, requested: true });
  const canAddToGroup =
    canJoinGroups(person) &&
    canRun("group.addMember", { groupId: snapshot.groups[0]?.id ?? "", personId: person.id });
  const orientationRecorded = snapshot.activity.some(
    (entry) => entry.personId === person.id && entry.type === "membership.orientation_completed",
  );
  const habit = attendanceHabit(snapshot, person, now);
  const groupNames = row?.groupNames ?? [];
  const pausedGroups = new Set(row?.inactiveGroupNames ?? []);
  const name = displayName(person);
  const firstName = name.split(" ")[0];
  const open = tasks.filter((entry) => entry.task.status !== "completed" && entry.task.status !== "cancelled");
  const finished = tasks.filter((entry) => entry.task.status === "completed" || entry.task.status === "cancelled");

  const menu: PersonMenuItem[] = [
    ...(canCorrect ? [{ label: "Edit details", onSelect: () => setEditing(true) }] : []),
    ...(canChangeStatus ? [{ label: "Change membership", onSelect: () => setStatusOpen(true) }] : []),
    ...(canAddToGroup ? [{ label: "Add to a group", onSelect: () => setGroupOpen(true) }] : []),
    ...(canNoteOrientation && !orientationRecorded
      ? [{ label: "Note that orientation is done", onSelect: () => void completeOrientation(person.id) }]
      : []),
    ...(canMarkContact
      ? [
          {
            label: member.requestedContact ? "They no longer need a call" : "They asked to be contacted",
            onSelect: () => void markRequestedContact(person.id, !member.requestedContact),
          },
        ]
      : []),
    ...(canDelete ? [{ label: "Delete their record", onSelect: () => setDeleting(true), destructive: true }] : []),
  ];

  /**
   * After a delete, this page has nothing left to show, so go back to the
   * list. The same when the server says the record has already gone.
   */
  const deleteRecord = async () => {
    const outcome = await remove(person.id, "Deletion requested");
    if (outcome.ok || outcome.code === "not_found") router.replace("/members");
  };

  return (
    <PageShell className="max-w-4xl space-y-10">
      <PersonHero
        person={person}
        eyebrow={`Member since ${formatDisplayDate(member.membershipDate)}`}
        summary={
          row?.lastAttendance
            ? `Last at church ${formatDisplayDate(row.lastAttendance)}.`
            : "No attendance recorded yet."
        }
        chips={
          <>
            <Chip tone={member.status === "new_member" || member.status === "active" ? "done" : "muted"}>
              {MEMBERSHIP_STATUS_LABELS[member.status]}
            </Chip>
            {person.contact.optedOut ? <Chip tone="warning">Do not contact</Chip> : null}
            {member.requestedContact ? <Chip tone="accent">Asked to be contacted</Chip> : null}
          </>
        }
        onMessage={
          can("communications.write") && !person.contact.optedOut ? () => setComposing(true) : undefined
        }
        menu={menu}
        footnote={`Member ${member.reference}`}
      />

      <Section title={open.length ? "Waiting for them" : "Nothing waiting"}>
        <TaskList
          tasks={open}
          now={now}
          emptyMessage={`Nothing is waiting for ${firstName} right now.`}
          onComplete={can("tasks.write") ? setCompleting : undefined}
          onReschedule={can("tasks.write") ? setRescheduling : undefined}
        />
      </Section>

      <Section title="How they're getting on">
        <div className="space-y-4 rounded-3xl border bg-card p-5">
          <div>
            <p className="font-medium">{habit.label}</p>
            <p className="text-sm text-muted-foreground">
              {habit.detail}
            </p>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">Groups</p>
            <div className="flex flex-wrap items-center gap-2">
              {groupNames.length ? (
                groupNames.map((group) => (
                  <span key={group} className="rounded-full bg-muted px-3 py-1 text-sm font-medium">
                    {group}
                    {pausedGroups.has(group) ? (
                      <span className="font-normal text-muted-foreground"> · not meeting</span>
                    ) : null}
                  </span>
                ))
              ) : (
                <span className="text-muted-foreground">Not in a group yet.</span>
              )}
              {canAddToGroup ? (
                <Button variant="ghost" size="lg" className="rounded-full" onClick={() => setGroupOpen(true)}>
                  <PlusIcon />
                  Add to a group
                </Button>
              ) : null}
            </div>
          </div>
          {row?.reviewReason ? (
            <div className="space-y-3 rounded-2xl bg-muted px-4 py-3">
              <p className="text-sm">
                {row.reviewReason} Nothing has been changed; it&apos;s worth checking in.
              </p>
              {canChangeStatus ? (
                <Button variant="outline" size="lg" className="rounded-full bg-background" onClick={() => setStatusOpen(true)}>
                  Change membership
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </Section>

      {careRecords.length ? (
        <Section title="Pastoral care">
          <ul className="divide-y overflow-hidden rounded-3xl border bg-card">
            {careRecords.map(({ record }) => (
              <li key={record.id}>
                <LinkButton
                  variant="ghost"
                  href="/pastoral-care"
                  className="flex h-auto min-h-14 w-full items-center justify-between gap-3 rounded-none px-5 py-3 text-left text-base font-normal whitespace-normal"
                >
                  <span className="min-w-0">
                    <span className="block">{record.summary}</span>
                    <span className="block text-xs text-muted-foreground">{record.reference}</span>
                  </span>
                  <ArrowRightIcon className="text-muted-foreground" />
                </LinkButton>
              </li>
            ))}
          </ul>
          <p className="text-sm text-muted-foreground">You can see this because your role allows it. Notes stay in Pastoral care.</p>
        </Section>
      ) : null}

      <Section title="Their journey">
        <div className="rounded-3xl border bg-card p-5">
          <JourneyTimeline milestones={journey.milestones} />
        </div>
      </Section>

      <FinishedFollowUps tasks={finished} />
      <CommunicationsPanel entries={communications} />

      <div className="space-y-3">
        <Disclosure
          title="Their details"
          summary={[person.phone, person.email].filter(Boolean).join(" · ") || "No phone or email yet"}
        >
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
              { label: "Household", value: row?.householdName ?? "Not part of a household yet" },
              { label: "Usual service", value: member.preferredServiceType?.replace(/_/g, " ") },
              {
                label: "First visited",
                value: person.visitor ? formatDisplayDate(person.visitor.firstVisitDate) : undefined,
              },
              { label: "Member number", value: member.reference },
            ]}
          />
          {canCorrect ? (
            <Button variant="outline" size="lg" className="mt-3 rounded-full" onClick={() => setEditing(true)}>
              Edit details
            </Button>
          ) : null}
        </Disclosure>

        {member.emergencyContact && can("care.read") ? (
          <Disclosure title="Emergency contact" badge={<RestrictedBadge />} summary="Only shown to people allowed to see pastoral care">
            <DetailList
              rows={[
                { label: "Name", value: member.emergencyContact.name },
                { label: "Relationship", value: member.emergencyContact.relationship },
                { label: "Phone", value: member.emergencyContact.phone },
              ]}
            />
            <p className="pt-3 text-xs text-muted-foreground">Never included in exports.</p>
          </Disclosure>
        ) : null}

        <AttendanceHistoryPanel entries={attendance} />
        <TimelinePanel events={journey.timeline} now={now} restrictedHidden={journey.restrictedHidden} />
      </div>

      <MessageComposer person={composing ? person : null} onOpenChange={(open) => !open && setComposing(false)} />

      <EditMemberDialog
        person={editing ? person : null}
        households={snapshot.households}
        onOpenChange={setEditing}
        onSave={async (changes) => (await correct(person.id, changes)).ok}
      />

      <MembershipStatusDialog
        open={statusOpen}
        onOpenChange={setStatusOpen}
        personName={name}
        current={member.status}
        onConfirm={(status, reason) => {
          changeStatus(person.id, status, reason);
          setStatusOpen(false);
        }}
      />

      <AddToGroupDialog
        open={groupOpen}
        onOpenChange={setGroupOpen}
        personName={name}
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
        title={`Delete ${firstName}'s record?`}
        description="Everything about them goes: their visits (so past headcounts drop by one), follow-ups, messages and timeline. They leave every group they're in, and stop being anyone's household contact. Only an anonymous note that something was deleted is kept. This can't be undone."
        confirmLabel="Delete for good"
        destructive
        onConfirm={() => void deleteRecord()}
      />
    </PageShell>
  );
}
