"use client";

import { Switch } from "@/components/ui/switch";
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
  return (
    <div className="space-y-6">
      <TeamAccountsCard />
      <SettingsPanel
        title="Who follow-ups can go to"
        description="Switch someone off when they step back. They keep their history but get no new follow-ups."
      >
        <ul className="-mx-5 divide-y border-y md:-mx-6">
          {settings.team.map((member) => (
            <li key={member.id} className="flex min-h-14 items-center justify-between gap-3 px-5 py-3 md:px-6">
              <div className="min-w-0">
                <p className="truncate font-medium">{member.name}</p>
                <p className="text-sm text-muted-foreground">
                  {DEMO_ROLE_LABELS[member.role]}
                  {member.title ? ` · ${member.title}` : ""}
                </p>
              </div>
              <Switch
                checked={member.active}
                onCheckedChange={(checked) => settings.setMemberActive(member.id, checked === true)}
                aria-label={`${member.name} active`}
              />
            </li>
          ))}
        </ul>
      </SettingsPanel>
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
