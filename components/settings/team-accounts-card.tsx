"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { CopyIcon, MailPlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { formatDisplayDateTime } from "@/lib/dates";
import {
  createInvitation,
  fetchInvitations,
  fetchMembers,
  removeMember,
  revokeInvitation,
  setMemberRole,
  type AccountMember,
  type Invitation,
} from "@/services/commands/client";
import { useChurchStore } from "@/stores/church-store";
import { useSnapshot } from "@/hooks/use-church-data";
import { DEMO_ROLES, DEMO_ROLE_LABELS, type DemoRole } from "@/types/team";
import { SelectField } from "@/components/shared/select-field";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { openTasksFor } from "@/services/settings/settings";
import type { ChurchSnapshot } from "@/types/snapshot";
import type { TeamMember } from "@/types/team";
import { SettingsPanel } from "./settings-panel";

const INVITABLE_ROLES = DEMO_ROLES.filter((role) => role !== "member");

const INVITABLE_ROLE_OPTIONS = INVITABLE_ROLES.map((option) => ({ value: option, label: DEMO_ROLE_LABELS[option] }));

/**
 * Who can sign in to this church, and the invitations still open.
 *
 * Accounts and team members are different things: a team member is who
 * work is assigned to; an account is who can sign in and act as one. This
 * card manages the accounts; "Who follow-ups can go to" manages the people.
 */
export function TeamAccountsCard({ onStranded }: { onStranded?: (member: TeamMember) => void }) {
  const snapshot = useSnapshot();
  const [removing, setRemoving] = useState<AccountMember | null>(null);
  const refresh = useChurchStore((state) => state.refresh);
  const [members, setMembers] = useState<AccountMember[] | null>(null);
  const [invitations, setInvitations] = useState<Invitation[] | null>(null);

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<DemoRole>("volunteer");
  const [teamMemberId, setTeamMemberId] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const reload = useCallback(
    () =>
      Promise.all([fetchMembers(), fetchInvitations()]).then(([memberList, invitationList]) => {
        if (memberList.ok) setMembers(memberList.value.members);
        else toast.error("Could not load the accounts", { description: memberList.error });
        if (invitationList.ok) setInvitations(invitationList.value.invitations);
      }),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    void Promise.all([fetchMembers(), fetchInvitations()]).then(([memberList, invitationList]) => {
      if (cancelled) return;
      if (memberList.ok) setMembers(memberList.value.members);
      else toast.error("Could not load the accounts", { description: memberList.error });
      if (invitationList.ok) setInvitations(invitationList.value.invitations);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Team members with no account and no invitation waiting are the ones an
  // invitation can attach to.
  const linked = new Set([
    ...(members ?? []).map((member) => member.teamMemberId),
    ...(invitations ?? []).map((invitation) => invitation.teamMemberId),
  ]);
  const unlinked = snapshot.team.filter((member) => member.active && !linked.has(member.id));

  async function onInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setLink(null);
    const outcome = await createInvitation({ email, role, teamMemberId: teamMemberId || undefined });
    setSubmitting(false);
    if (!outcome.ok) {
      toast.error(outcome.error);
      return;
    }
    setLink(outcome.value.link);
    const to = outcome.value.invitation.email;
    const delivery = outcome.value.delivery;
    if (delivery.emailed) {
      toast.success(`Invitation emailed to ${to}`);
    } else {
      // Long enough to read: the person still has to send the link themselves.
      toast.warning("Invitation not emailed", {
        description: `${delivery.reason} Copy the link below and send it to ${to} yourself.`,
        duration: 15_000,
      });
    }
    // Back to the least access each time, so the next invitation never
    // quietly goes out with the last one's role.
    setEmail("");
    setRole("volunteer");
    setTeamMemberId("");
    await reload();
  }

  async function copyLink() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      toast.success("Invitation link copied");
    } catch {
      toast.error("Could not reach the clipboard. Select the link and copy it manually.");
    }
  }

  return (
    <div className="space-y-6">
      <SettingsPanel
        title="Invite someone"
        description="They get an email with a link that works for seven days. The link also shows here once, in case you'd rather send it yourself."
      >
        <form onSubmit={onInvite} className="grid gap-4 md:grid-cols-[1fr_auto_auto] md:items-end">
          <Field>
            <FieldLabel htmlFor="invite-email">Email</FieldLabel>
            <Input id="invite-email" type="email" required className="h-11" value={email} onChange={(event) => setEmail(event.target.value)} />
          </Field>
          <SelectField
            id="invite-role"
            label="Role"
            value={role}
            onValueChange={(value) => setRole(value as DemoRole)}
            options={INVITABLE_ROLE_OPTIONS}
          />
          <SelectField
            id="invite-team-member"
            label="Follow-ups go to them as"
            value={teamMemberId}
            onValueChange={setTeamMemberId}
            options={[
              { value: "", label: "Someone new on the team" },
              ...unlinked.map((member) => ({ value: member.id, label: member.name })),
            ]}
          />
          <div className="md:col-span-3">
            <Button type="submit" size="lg" className="gap-2 rounded-full" disabled={submitting || !email}>
              <MailPlusIcon />
              Send invitation
            </Button>
          </div>
        </form>
        {link ? (
          <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-muted px-4 py-3">
            <code className="min-w-0 flex-1 truncate text-xs">{link}</code>
            <Button variant="outline" className="min-h-11 gap-1.5 rounded-full" onClick={() => void copyLink()}>
              <CopyIcon />
              Copy link
            </Button>
          </div>
        ) : null}
      </SettingsPanel>

      <SettingsPanel
        title="People who can sign in"
        description="The role decides what each person can see and do."
      >
        <ul className="-mx-5 divide-y border-y md:-mx-6">
          {members?.map((member) => (
            <li key={member.userId} className="flex min-h-14 flex-wrap items-center justify-between gap-3 px-5 py-3 md:px-6">
              <div className="min-w-0">
                <p className="truncate font-medium">
                  {member.name || member.email}
                  {member.self ? (
                    <span className="ml-2 rounded-full bg-primary/12 px-2.5 py-0.5 text-xs font-medium text-primary dark:text-foreground">
                      You
                    </span>
                  ) : null}
                </p>
                <p className="truncate text-sm text-muted-foreground">{member.email}</p>
              </div>
              <div className="flex items-center gap-1">
                <SelectField
                  aria-label={`Role for ${member.email}`}
                  className="w-auto"
                  value={member.role}
                  disabled={member.self}
                  options={INVITABLE_ROLE_OPTIONS}
                  onValueChange={async (value) => {
                    const next = value as DemoRole;
                    const outcome = await setMemberRole(member.userId, next);
                    if (!outcome.ok) toast.error(outcome.error);
                    else {
                      toast.success(`${member.name || member.email} is now ${DEMO_ROLE_LABELS[next].toLowerCase()}.`);
                      await Promise.all([reload(), refresh()]);
                    }
                  }}
                />
                {!member.self ? (
                  <Button
                    variant="ghost"
                    size="icon-lg"
                    className="rounded-full text-muted-foreground"
                    aria-label={`Remove ${member.email}`}
                    onClick={() => setRemoving(member)}
                  >
                    <Trash2Icon />
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
          {invitations?.map((invitation) => (
            <li key={invitation.id} className="flex min-h-14 flex-wrap items-center justify-between gap-3 px-5 py-3 md:px-6">
              <div className="min-w-0">
                <p className="truncate font-medium">{invitation.email}</p>
                <p className="text-sm text-muted-foreground">
                  Invited as {DEMO_ROLE_LABELS[invitation.role].toLowerCase()}, not joined yet · link works until{" "}
                  {formatDisplayDateTime(invitation.expiresAt)}
                </p>
              </div>
              <Button
                variant="ghost"
                className="min-h-11 rounded-full"
                onClick={async () => {
                  const outcome = await revokeInvitation(invitation.id);
                  if (!outcome.ok) toast.error(outcome.error);
                  else await reload();
                }}
              >
                Withdraw
              </Button>
            </li>
          ))}
        </ul>
      </SettingsPanel>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Remove ${removing ? removing.name || removing.email : "this account"}?`}
        description={removalWarning(removing, snapshot)}
        confirmLabel="Remove account"
        destructive
        onConfirm={() => {
          if (removing) void remove(removing);
        }}
      />
    </div>
  );

  async function remove(member: AccountMember) {
    const outcome = await removeMember(member.userId);
    if (!outcome.ok) {
      toast.error(outcome.error);
      return;
    }
    const [, ...notices] = outcome.value.notices ?? [];
    toast.success(`${member.name || member.email} can no longer sign in to this church.`, {
      description: notices.length ? notices.join(" ") : undefined,
    });
    await Promise.all([reload(), refresh()]);
    const teamMember = snapshot.team.find((entry) => entry.id === outcome.value.teamMemberId);
    if (teamMember && outcome.value.openTasks > 0) onStranded?.(teamMember);
  }
}

/** Names the person and what happens to their open follow-ups. */
function removalWarning(member: AccountMember | null, snapshot: ChurchSnapshot): string {
  if (!member) return "";
  const who = member.name || member.email;
  const teamMember = snapshot.team.find((entry) => entry.id === member.teamMemberId);
  const open = teamMember ? openTasksFor(snapshot, teamMember.id).length : 0;
  const work = open
    ? ` ${open} open follow-up${open === 1 ? " is" : "s are"} still with them; you can move ${open === 1 ? "it" : "them"} to someone else next.`
    : "";
  return `${who} won't be able to sign in to this church any more, and they'll be switched off in the team list so no new follow-ups go to them. Their past work keeps their name.${work}`;
}
