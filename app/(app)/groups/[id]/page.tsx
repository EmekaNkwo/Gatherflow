"use client";

import { meetsLabel } from "@/lib/groups";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ChevronRightIcon,
  EllipsisIcon,
  ShieldIcon,
  UserPlusIcon,
  XIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LinkButton } from "@/components/shared/link-button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { OptedOutBadge } from "@/components/shared/badges";
import { PageHeader, PageShell, Section } from "@/components/shared/page-header";
import { personHref } from "@/components/shared/person-cell";
import { formatDisplayDate } from "@/lib/dates";
import { matchesPersonQuery } from "@/lib/person-search";
import { displayName } from "@/lib/strings";
import { canJoinGroups } from "@/services/groups/groups";
import { GROUP_TYPE_LABELS } from "@/types/group";
import { useRole } from "@/hooks/useRole";
import { useGroup, useGroups } from "@/hooks/useGroups";
import { useSnapshot } from "@/hooks/use-church-data";


/**
 * One group: when it meets and who leads it up top, the people in it, and
 * one clear action (add someone). Leader changes, removal and pausing the
 * group sit behind each row's or the page's "More" menu.
 */
export default function GroupPage() {
  const params = useParams<{ id: string }>();
  const groupId = params.id;

  const snapshot = useSnapshot();
  const entry = useGroup(groupId);
  const { addMember, removeMember, assignLeader, setActive } = useGroups();
  const { can, canRun } = useRole();

  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState("");
  const [removing, setRemoving] = useState<{ personId: string; name: string } | null>(null);

  // Gated by the commands these controls send, as the server checks them.
  const canEdit = canRun("group.addMember", { groupId, personId: "" });

  /**
   * People who could join: not already in it, still part of the church
   * (transferred and archived members can't be added), and matching the
   * shared person search (preferred names, any word order, accents, phones).
   */
  const candidates = useMemo(() => {
    if (!entry) return [];
    return snapshot.people
      .filter(
        (person) =>
          !entry.group.members.some((member) => member.personId === person.id) &&
          canJoinGroups(person) &&
          matchesPersonQuery(person, search),
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
            <LinkButton href="/groups" className="min-h-11 rounded-full">
              Back to groups
            </LinkButton>
          }
        />
      </PageShell>
    );
  }

  const { group, leader, members } = entry;

  return (
    <PageShell className="max-w-4xl space-y-10">
      <PageHeader
        title={group.name}
        description={group.description || undefined}
        actions={
          canEdit ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    size="icon-lg"
                    variant="ghost"
                    className="rounded-full"
                    aria-label={`More for ${group.name}`}
                  >
                    <EllipsisIcon />
                  </Button>
                }
              />
              <DropdownMenuContent align="end">
                <DropdownMenuItem className="min-h-11" onClick={() => setActive(group.id, !group.active)}>
                  {group.active ? "Mark as inactive" : "Reactivate group"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null
        }
      />

      <section className="flex flex-col gap-5 rounded-[2rem] bg-warm px-6 py-7 sm:flex-row sm:items-center sm:justify-between md:px-10">
        <div className="space-y-1">
          <p className="text-sm font-medium text-muted-foreground">
            {GROUP_TYPE_LABELS[group.type]}
            {group.active ? "" : " · not meeting at the moment"}
          </p>
          <h2 className="text-2xl font-medium md:text-3xl">
            {group.schedule ? meetsLabel(group.schedule) : "No regular meeting time"}
          </h2>
          <p className="text-muted-foreground">
            {group.location ? `${group.location} · ` : ""}
            Led by {leader ? displayName(leader) : "nobody yet"} · {members.length}{" "}
            {members.length === 1 ? "person" : "people"}
          </p>
          {group.involvesMinors ? (
            <p className="flex items-center gap-1.5 pt-1 text-sm text-muted-foreground">
              <ShieldIcon className="size-4 shrink-0" />
              Works with under-18s, so details stay inside this group.
            </p>
          ) : null}
        </div>
        {canEdit && group.active ? (
          <Button
            size="lg"
            className="h-12 shrink-0 gap-2 rounded-full px-6 text-base"
            aria-expanded={adding}
            onClick={() => setAdding((open) => !open)}
          >
            {adding ? <XIcon /> : <UserPlusIcon />}
            {adding ? "Done adding" : "Add someone"}
          </Button>
        ) : null}
      </section>

      {canEdit && adding && group.active ? (
        <Section title="Add someone" description="Adding somebody is always recorded against your name.">
          <div className="space-y-3 rounded-3xl border bg-card p-5">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by name or phone"
              aria-label="Search people to add"
              className="h-11 rounded-full"
              autoFocus
            />
            {candidates.length ? (
              <ul className="max-h-96 divide-y overflow-y-auto">
                {candidates.map((person) => (
                  <li key={person.id} className="flex min-h-14 items-center gap-3 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{displayName(person)}</span>
                      <span className="block truncate text-sm text-muted-foreground">
                        {person.member ? "Member" : "Visitor"}
                      </span>
                    </span>
                    <Button
                      variant="outline"
                      className="min-h-11 shrink-0 gap-1.5 rounded-full"
                      aria-label={`Add ${displayName(person)}`}
                      onClick={() => addMember(group.id, person.id)}
                    >
                      <UserPlusIcon />
                      Add
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-2xl bg-muted px-4 py-3 text-muted-foreground">
                Nobody else matches that search.
              </p>
            )}
          </div>
        </Section>
      ) : null}

      <Section title="Who's in it">
        {members.length ? (
          <ul className="divide-y overflow-hidden rounded-3xl border bg-card">
            {members.map(({ membership, person }) =>
              person ? (
                <li key={membership.personId} className="flex items-center gap-1 pr-2">
                  <Link
                    href={personHref(person)}
                    className="flex min-h-14 min-w-0 flex-1 items-center gap-3 py-3 pl-5 hover:underline"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate font-medium">{displayName(person)}</span>
                        {membership.role === "leader" ? (
                          <span className="shrink-0 rounded-full bg-primary/12 px-2.5 py-0.5 text-xs font-medium text-primary dark:text-foreground">
                            Leader
                          </span>
                        ) : null}
                      </span>
                      <span className="block truncate text-sm text-muted-foreground">
                        Joined {formatDisplayDate(membership.joinedAt)}
                      </span>
                    </span>
                    {person.contact.optedOut ? <OptedOutBadge className="shrink-0" /> : null}
                  </Link>
                  {canEdit ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            size="icon-lg"
                            variant="ghost"
                            className="shrink-0 rounded-full"
                            aria-label={`More for ${displayName(person)}`}
                          >
                            <EllipsisIcon />
                          </Button>
                        }
                      />
                      <DropdownMenuContent align="end">
                        {membership.role !== "leader" ? (
                          <DropdownMenuItem
                            className="min-h-11"
                            onClick={() => assignLeader(group.id, person.id)}
                          >
                            Make leader
                          </DropdownMenuItem>
                        ) : null}
                        <DropdownMenuItem
                          className="min-h-11"
                          variant="destructive"
                          onClick={() => setRemoving({ personId: person.id, name: displayName(person) })}
                        >
                          Remove from group
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : (
                    <ChevronRightIcon className="mr-3 size-5 shrink-0 text-muted-foreground" />
                  )}
                </li>
              ) : null,
            )}
          </ul>
        ) : (
          <p className="rounded-2xl bg-muted px-5 py-4 text-muted-foreground">
            Nobody is in this group yet.
          </p>
        )}
      </Section>

      <Section title="Meetings">
        <GroupAttendance groupId={group.id} canRecord={can("attendance.write")} />
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

function GroupAttendance({ groupId, canRecord }: { groupId: string; canRecord: boolean }) {
  const snapshot = useSnapshot();
  const sessions = snapshot.sessions.filter((session) => session.groupId === groupId);

  if (!sessions.length) {
    return (
      <div className="flex flex-col gap-3 rounded-2xl bg-muted px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-muted-foreground">
          No meetings recorded yet. Add one on the check-in page and choose this group.
        </p>
        {canRecord ? (
          <LinkButton variant="outline" href="/attendance" className="min-h-11 shrink-0 rounded-full">
            Go to check-in
          </LinkButton>
        ) : null}
      </div>
    );
  }

  return (
    <ul className="divide-y overflow-hidden rounded-3xl border bg-card">
      {sessions.map((session) => {
        const present = snapshot.attendance.filter(
          (row) => row.sessionId === session.id && row.status === "present",
        ).length;
        return (
          <li key={session.id}>
            <Link
              href={`/attendance/${session.id}`}
              className="flex min-h-14 items-center gap-3 px-5 py-3 hover:bg-muted/50"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{session.name}</span>
                <span className="block text-sm text-muted-foreground">
                  {formatDisplayDate(session.date)}
                </span>
              </span>
              <span className="shrink-0 text-sm tabular-nums text-muted-foreground">{present} came</span>
              <ChevronRightIcon className="size-5 shrink-0 text-muted-foreground" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
