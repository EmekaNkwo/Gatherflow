"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { ShieldIcon, UserMinusIcon, UserPlusIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LinkButton } from "@/components/shared/link-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader, PageShell, Section } from "@/components/shared/page-header";
import { PersonCell, personHref } from "@/components/shared/person-cell";
import { StatTile } from "@/components/shared/metric-card";
import { formatDisplayDate } from "@/lib/dates";
import { displayName, normalise } from "@/lib/strings";
import { GROUP_TYPE_LABELS } from "@/types/group";
import { useDemoRole } from "@/hooks/useDemoRole";
import { useGroup, useGroups } from "@/hooks/useGroups";
import { useSnapshot } from "@/hooks/use-church-data";

/** One group: who is in it, who leads it, and when it meets. */
export default function GroupPage() {
  const params = useParams<{ id: string }>();
  const groupId = params.id;

  const snapshot = useSnapshot();
  const entry = useGroup(groupId);
  const { addMember, removeMember, assignLeader, setActive } = useGroups();
  const { can } = useDemoRole();

  const [search, setSearch] = useState("");
  const [removing, setRemoving] = useState<{ personId: string; name: string } | null>(null);

  const canEdit = can("groups.write");

  const candidates = useMemo(() => {
    if (!entry) return [];
    const needle = normalise(search);
    return snapshot.people
      .filter(
        (person) =>
          !entry.group.members.some((member) => member.personId === person.id) &&
          (!needle ||
            normalise(`${person.firstName} ${person.lastName}`).includes(needle)),
      )
      .slice(0, 10);
  }, [entry, snapshot.people, search]);

  if (!entry) {
    return (
      <PageShell>
        <EmptyState
          title="That group no longer exists"
          description="It may have been removed."
          action={
            <LinkButton size="sm" href="/groups">
              Back to groups
            </LinkButton>
          }
        />
      </PageShell>
    );
  }

  const { group, leader, members } = entry;

  return (
    <PageShell>
      <PageHeader
        title={group.name}
        description={group.description}
        actions={
          canEdit ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setActive(group.id, !group.active)}
            >
              {group.active ? "Mark as inactive" : "Reactivate group"}
            </Button>
          ) : null
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{GROUP_TYPE_LABELS[group.type]}</Badge>
        {!group.active ? <Badge variant="outline">Inactive</Badge> : null}
        {group.involvesMinors ? (
          <Badge variant="outline" className="gap-1">
            <ShieldIcon />
            Works with under-18s
          </Badge>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Members" value={members.length} />
        <StatTile label="Leader" value={leader ? displayName(leader) : "None"} />
        <StatTile
          label="Meets"
          value={
            group.schedule
              ? `${group.schedule.weekday} ${group.schedule.time}`
              : "No schedule"
          }
          detail={group.schedule?.frequency}
        />
        <StatTile label="Location" value={group.location ?? "—"} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Members</CardTitle>
            <CardDescription>
              Each membership records who added the person and when.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {members.length ? (
              <ul className="space-y-2">
                {members.map(({ membership, person }) => (
                  <li
                    key={membership.personId}
                    className="flex items-center justify-between gap-2 rounded-lg border p-2"
                  >
                    {person ? (
                      <PersonCell
                        person={person}
                        href={personHref(person)}
                        subtitle={`Joined ${formatDisplayDate(membership.joinedAt)}${
                          membership.role === "leader" ? " · leader" : ""
                        }`}
                      />
                    ) : null}
                    {canEdit && person ? (
                      <div className="flex shrink-0 gap-1.5">
                        {membership.role !== "leader" ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => assignLeader(group.id, person.id)}
                          >
                            Make leader
                          </Button>
                        ) : null}
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Remove ${displayName(person)}`}
                          onClick={() =>
                            setRemoving({ personId: person.id, name: displayName(person) })
                          }
                        >
                          <UserMinusIcon />
                        </Button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Nobody is in this group yet.</p>
            )}
          </CardContent>
        </Card>

        {canEdit ? (
          <Card>
            <CardHeader>
              <CardTitle>Add someone</CardTitle>
              <CardDescription>
                Adding somebody is always a deliberate action, recorded against your name.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search the directory"
                aria-label="Search people to add"
              />
              <ul className="max-h-80 space-y-1.5 overflow-y-auto">
                {candidates.map((person) => (
                  <li
                    key={person.id}
                    className="flex items-center justify-between gap-2 rounded-lg border p-2"
                  >
                    <PersonCell
                      person={person}
                      subtitle={
                        person.member ? `Member ${person.member.reference}` : "Visitor record"
                      }
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5"
                      onClick={() => addMember(group.id, person.id)}
                      disabled={!group.active}
                    >
                      <UserPlusIcon />
                      Add
                    </Button>
                  </li>
                ))}
                {!candidates.length ? (
                  <li className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                    Nobody else matches that search.
                  </li>
                ) : null}
              </ul>
            </CardContent>
          </Card>
        ) : null}
      </div>

      <Section title="Group attendance" description="Meetings recorded against this group.">
        <GroupAttendance groupId={group.id} />
      </Section>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Remove ${removing?.name ?? "this person"} from ${group.name}?`}
        description="Their attendance history stays as it is. Only the group membership is removed."
        confirmLabel="Remove from group"
        destructive
        onConfirm={() => {
          if (removing) removeMember(group.id, removing.personId);
          setRemoving(null);
        }}
      />
    </PageShell>
  );
}

function GroupAttendance({ groupId }: { groupId: string }) {
  const snapshot = useSnapshot();
  const sessions = snapshot.sessions.filter((session) => session.groupId === groupId);

  if (!sessions.length) {
    return (
      <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
        No meetings have been recorded against this group yet. Create a session from the attendance
        page and choose this group.
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {sessions.map((session) => {
        const present = snapshot.attendance.filter(
          (row) => row.sessionId === session.id && row.status === "present",
        ).length;
        return (
          <li key={session.id} className="rounded-lg border p-2 text-sm">
            <LinkButton variant="link" size="sm" href={`/attendance/${session.id}`}>
              {session.name} · {formatDisplayDate(session.date)}
            </LinkButton>
            <span className="ml-2 text-xs text-muted-foreground">{present} present</span>
          </li>
        );
      })}
    </ul>
  );
}
