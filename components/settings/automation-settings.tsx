"use client";

import { useState } from "react";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { useChurchSettings } from "@/hooks/useChurchSettings";
import { AUTOMATION_RULE_DESCRIPTIONS, AUTOMATION_RULE_LABELS, type AutomationRuleConfig } from "@/types/settings";
import { DisclosureButton } from "./settings-panel";

type ChurchSettings = ReturnType<typeof useChurchSettings>;

/**
 * The Automation tab: each rule is a sentence and a switch. How soon the task
 * is due and who it goes to sit behind "Details", since they rarely change.
 */
export function AutomationSettings({ settings }: { settings: ChurchSettings }) {
  return (
    <div className="space-y-4">
      <p className="max-w-2xl text-muted-foreground">
        These rules add follow-ups when something actually happens, such as a visitor registering or coming back.
        The same follow-up is never added twice, and nothing is added for anyone who has asked not to be contacted.
        Changes save straight away.
      </p>
      <ul className="divide-y overflow-hidden rounded-3xl border bg-card">
        {settings.rules.map((rule) => (
          <RuleRow key={rule.id} rule={rule} settings={settings} />
        ))}
      </ul>
    </div>
  );
}

function RuleRow({ rule, settings }: { rule: AutomationRuleConfig; settings: ChurchSettings }) {
  const [open, setOpen] = useState(false);
  const label = AUTOMATION_RULE_LABELS[rule.id];
  const assignee = settings.team.find((member) => member.id === rule.defaultAssigneeId);
  const assignable = settings.team.filter((member) => member.active && member.role !== "member");
  const hasDetails = rule.id !== "overdue_alert";

  return (
    <li className="space-y-3 px-5 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="font-medium">{label}</p>
          <p className="text-sm text-muted-foreground">{AUTOMATION_RULE_DESCRIPTIONS[rule.id]}</p>
          {hasDetails ? (
            <p className="text-sm text-muted-foreground">
              Due in {rule.dueInDays} {rule.dueInDays === 1 ? "day" : "days"} · {assignee ? `for ${assignee.name}` : "nobody assigned yet"}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Overdue work is worked out from due dates whenever it is shown, so nothing stored can fall out of step.
            </p>
          )}
        </div>
        <Switch
          checked={rule.enabled}
          onCheckedChange={(checked) => settings.saveRule(rule.id, { enabled: checked === true })}
          aria-label={`${label} enabled`}
          className="mt-1"
        />
      </div>

      {hasDetails ? (
        <>
          <DisclosureButton open={open} onToggle={() => setOpen((value) => !value)} controls={`${rule.id}-details`}>
            Details
          </DisclosureButton>
          {open ? (
            <div id={`${rule.id}-details`} className="grid gap-4 rounded-2xl bg-muted px-4 py-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor={`${rule.id}-due`}>Due in (days)</FieldLabel>
                <Input
                  id={`${rule.id}-due`}
                  type="number"
                  min={0}
                  max={90}
                  className="h-11 bg-card"
                  value={rule.dueInDays}
                  onChange={(event) => settings.saveRule(rule.id, { dueInDays: Number(event.target.value) })}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`${rule.id}-assignee`}>Give it to</FieldLabel>
                <NativeSelect
                  className="w-full"
                  id={`${rule.id}-assignee`}
                  value={rule.defaultAssigneeId ?? ""}
                  onChange={(event) =>
                    settings.saveRule(rule.id, { defaultAssigneeId: event.target.value || undefined })
                  }
                >
                  <NativeSelectOption value="">Nobody yet</NativeSelectOption>
                  {assignable.map((member) => (
                    <NativeSelectOption key={member.id} value={member.id}>
                      {member.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
            </div>
          ) : null}
        </>
      ) : null}
    </li>
  );
}
