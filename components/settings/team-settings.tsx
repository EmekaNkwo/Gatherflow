"use client";

import { useState } from "react";
import { Switch } from "@/components/ui/switch";
import { useSnapshot } from "@/hooks/use-church-data";
import { openTasksFor } from "@/services/settings/settings";
import { useSessionStore } from "@/stores/session-store";
import type { TeamMember } from "@/types/team";
import { ReassignDialog } from "./reassign-dialog";
import { useChurchSettings } from "@/hooks/useChurchSettings";
import { DEMO_ROLE_LABELS } from "@/types/team";
import { SettingsPanel } from "./settings-panel";
import { TeamAccountsCard } from "./team-accounts-card";

type ChurchSettings = ReturnType<typeof useChurchSettings>;

/**
 * The Team tab. Two different lists, said plainly: who can sign in (the
 * accounts, with their invitations), and who follow-ups can be given to.
 */
export function TeamSettings({ settings }: { settings: ChurchSettings }) {
  const snapshot = useSnapshot();
  const myTeamMemberId = useSessionStore((state) => state.teamMemberId);
  const [reassigning, setReassigning] = useState<TeamMember | null>(null);

  async function toggle(member: TeamMember, active: boolean) {
    const outcome = await settings.setMemberActive(member.id, active);
    // Switched off with work still open: offer to move it straight away.
    if (outcome.ok && !active && outcome.value.openTasks > 0) setReassigning(member);
  }

  return (
    <div className="space-y-6">
      <TeamAccountsCard onStranded={setReassigning} />
      <SettingsPanel
        title="Who follow-ups can go to"
        description="Switch someone off when they step back. They keep their history but get no new follow-ups."
      >
        <ul className="-mx-5 divide-y border-y md:-mx-6">
          {settings.team.map((member) => {
            const self = member.id === myTeamMemberId;
            const stranded = member.active ? 0 : openTasksFor(snapshot, member.id).length;
            return (
              <li key={member.id} className="flex min-h-14 flex-wrap items-center justify-between gap-3 px-5 py-3 md:px-6">
                <div className="min-w-0">
                  <p className="truncate font-medium">{member.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {DEMO_ROLE_LABELS[member.role]}
                    {member.title ? ` · ${member.title}` : ""}
                    {self ? " · that's you, so another administrator would switch you off" : ""}
                  </p>
                  {stranded ? (
                    <p className="text-sm text-destructive">
                      {stranded} open follow-up{stranded === 1 ? " is" : "s are"} still with them.{" "}
                      <button
                        type="button"
                        className="min-h-11 font-medium underline underline-offset-4"
                        onClick={() => setReassigning(member)}
                      >
                        Move {stranded === 1 ? "it" : "them"}
                      </button>
                    </p>
                  ) : null}
                </div>
                <Switch
                  checked={member.active}
                  disabled={self && member.active}
                  onCheckedChange={(checked) => void toggle(member, checked === true)}
                  aria-label={`${member.name} active`}
                />
              </li>
            );
          })}
        </ul>
      </SettingsPanel>
      <ReassignDialog member={reassigning} onOpenChange={(open) => !open && setReassigning(null)} />
    </div>
  );
}

/** The Pipeline tab: the steps a visitor moves through, in order. */
export function PipelineSettings({ settings }: { settings: ChurchSettings }) {
  return (
    <SettingsPanel
      title="Steps for visitors"
      description="The steps a visitor moves through, in order. A step that still has visitors in it can't be removed, so nobody loses their place."
    >
      <ol className="-mx-5 divide-y border-y md:-mx-6">
        {settings.stages.map((stage, index) => (
          <li key={stage.id} className="flex min-h-14 items-start gap-4 px-5 py-3 md:px-6">
            <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium tabular-nums">
              {index + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                {stage.name}
                {stage.kind === "terminal" ? (
                  <span className="ml-2 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                    Ends follow-up
                  </span>
                ) : null}
              </p>
              {stage.description ? <p className="text-sm text-muted-foreground">{stage.description}</p> : null}
            </div>
          </li>
        ))}
      </ol>
    </SettingsPanel>
  );
}
