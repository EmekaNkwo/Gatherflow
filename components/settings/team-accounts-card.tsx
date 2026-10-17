"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { CopyIcon, MailPlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
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
  type InvitationDelivery,
} from "@/services/commands/client";
import { useChurchStore } from "@/stores/church-store";
import { useSnapshot } from "@/hooks/use-church-data";
import { DEMO_ROLES, DEMO_ROLE_LABELS, type DemoRole } from "@/types/team";
import { SettingsPanel } from "./settings-panel";

const INVITABLE_ROLES = DEMO_ROLES.filter((role) => role !== "member");

/**
 * Who can sign in to this church, and the invitations still open.
 *
 * Accounts and team members are different things: a team member is who
 * work is assigned to; an account is who can sign in and act as one. This
 * card manages the accounts; "Who follow-ups can go to" manages the people.
 */
export function TeamAccountsCard() {
  const snapshot = useSnapshot();
  const refresh = useChurchStore((state) => state.refresh);
  const [members, setMembers] = useState<AccountMember[] | null>(null);
  const [invitations, setInvitations] = useState<Invitation[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<DemoRole>("volunteer");
  const [teamMemberId, setTeamMemberId] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const [delivery, setDelivery] = useState<{ to: string; outcome: InvitationDelivery } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const reload = useCallback(
    () =>
      Promise.all([fetchMembers(), fetchInvitations()]).then(([memberList, invitationList]) => {
        if (memberList.ok) setMembers(memberList.value.members);
        else setError(memberList.error);
        if (invitationList.ok) setInvitations(invitationList.value.invitations);
      }),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    void Promise.all([fetchMembers(), fetchInvitations()]).then(([memberList, invitationList]) => {
      if (cancelled) return;
      if (memberList.ok) setMembers(memberList.value.members);
      else setError(memberList.error);
      if (invitationList.ok) setInvitations(invitationList.value.invitations);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Team members with no account yet are the ones an invitation can attach to.
  const linked = new Set((members ?? []).map((member) => member.teamMemberId));
  const unlinked = snapshot.team.filter((member) => member.active && !linked.has(member.id));

  async function onInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setLink(null);
    setDelivery(null);
    const outcome = await createInvitation({ email, role, teamMemberId: teamMemberId || undefined });
    setSubmitting(false);
    if (!outcome.ok) {
      toast.error(outcome.error);
      return;
    }
    setLink(outcome.value.link);
    setDelivery({ to: outcome.value.invitation.email, outcome: outcome.value.delivery });
    setEmail("");
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
          <Field>
            <FieldLabel htmlFor="invite-role">Role</FieldLabel>
            <NativeSelect id="invite-role" className="w-full" value={role} onChange={(event) => setRole(event.target.value as DemoRole)}>
              {INVITABLE_ROLES.map((option) => (
                <NativeSelectOption key={option} value={option}>
                  {DEMO_ROLE_LABELS[option]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor="invite-team-member">Follow-ups go to them as</FieldLabel>
            <NativeSelect id="invite-team-member" className="w-full" value={teamMemberId} onChange={(event) => setTeamMemberId(event.target.value)}>
              <NativeSelectOption value="">Someone new on the team</NativeSelectOption>
              {unlinked.map((member) => (
                <NativeSelectOption key={member.id} value={member.id}>
                  {member.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <div className="md:col-span-3">
            <Button type="submit" size="lg" className="gap-2 rounded-full" disabled={submitting || !email}>
              <MailPlusIcon />
              Send invitation
            </Button>
          </div>
        </form>
        {delivery ? (
          <p role="status" className={delivery.outcome.emailed ? "text-muted-foreground" : "text-destructive"}>
            {delivery.outcome.emailed
              ? `Emailed to ${delivery.to}.`
              : `Not emailed: ${delivery.outcome.reason} Copy the link below and send it to ${delivery.to} yourself.`}
          </p>
        ) : null}
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
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
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
                <NativeSelect
                  aria-label={`Role for ${member.email}`}
                  value={member.role}
                  disabled={member.self}
                  onChange={async (event) => {
                    const next = event.target.value as DemoRole;
                    const outcome = await setMemberRole(member.userId, next);
                    if (!outcome.ok) toast.error(outcome.error);
                    else {
                      toast.success(`${member.name || member.email} is now ${DEMO_ROLE_LABELS[next].toLowerCase()}.`);
                      await Promise.all([reload(), refresh()]);
                    }
                  }}
                >
                  {INVITABLE_ROLES.map((option) => (
                    <NativeSelectOption key={option} value={option}>
                      {DEMO_ROLE_LABELS[option]}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                {!member.self ? (
                  <Button
                    variant="ghost"
                    size="icon-lg"
                    className="rounded-full text-muted-foreground"
                    aria-label={`Remove ${member.email}`}
                    onClick={async () => {
                      const outcome = await removeMember(member.userId);
                      if (!outcome.ok) toast.error(outcome.error);
                      else {
                        toast.success("Account removed from this church.");
                        await Promise.all([reload(), refresh()]);
                      }
                    }}
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
    </div>
  );
}
