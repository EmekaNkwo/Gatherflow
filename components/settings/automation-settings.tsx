"use client";

import { useState } from "react";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { checkDueInDays, DUE_IN_DAYS_MAX, DUE_IN_DAYS_MIN } from "@/services/settings/due-in-days";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/shared/select-field";
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
        Switches save straight away; a number saves when you leave its box.
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
  // Someone switched off still shows by name, so the choice never reads as a raw id.
  const assigneeOptions = [
    { value: "", label: "Nobody yet" },
    ...(assignee && !assignable.includes(assignee)
      ? [{ value: assignee.id, label: `${assignee.name} (inactive)`, disabled: true }]
      : []),
    ...assignable.map((member) => ({ value: member.id, label: member.name })),
  ];

  return (
    <li className="space-y-3 px-5 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="font-medium">{label}</p>
          <p className="text-sm text-muted-foreground">{AUTOMATION_RULE_DESCRIPTIONS[rule.id]}</p>
          {hasDetails ? (
            <p className="text-sm text-muted-foreground">
              Due in {rule.dueInDays} {rule.dueInDays === 1 ? "day" : "days"} ·{" "}
              {assignee ? `for ${assignee.name}` : "nobody assigned yet"}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Overdue work is worked out from due dates whenever it is shown, so nothing stored can fall out of step.
            </p>
          )}
          {hasDetails && assignee && !assignee.active ? (
            <p role="status" className="text-sm text-destructive">
              {assignee.name} is switched off, so new tasks from this rule are left without an owner. Choose someone
              else under Details.
            </p>
          ) : null}
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
              <DueInDaysField
                key={rule.dueInDays}
                id={`${rule.id}-due`}
                saved={rule.dueInDays}
                onSave={(dueInDays) => settings.saveRule(rule.id, { dueInDays })}
              />
              <SelectField
                id={`${rule.id}-assignee`}
                label="Give it to"
                value={rule.defaultAssigneeId ?? ""}
                // `null` is what clears it: `undefined` would vanish on the way to the server.
                onValueChange={(value) => settings.saveRule(rule.id, { defaultAssigneeId: value || null })}
                options={assigneeOptions}
              />
            </div>
          ) : null}
        </>
      ) : null}
    </li>
  );
}

/**
 * The number is the person's own while they type and is saved once, when
 * they leave the box or press Enter. Saving on every keystroke let slow
 * replies overwrite the box mid-word, so "14" could be saved as 4.
 */
function DueInDaysField({
  id,
  saved,
  onSave,
}: {
  id: string;
  saved: number;
  onSave: (dueInDays: number) => Promise<unknown>;
}) {
  const [value, setValue] = useState(String(saved));
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function commit() {
    const checked = checkDueInDays(value);
    setProblem(checked.ok ? null : checked.error);
    if (!checked.ok || checked.value === saved || saving) return;
    setSaving(true);
    await onSave(checked.value);
    setSaving(false);
  }

  return (
    <Field data-invalid={problem ? true : undefined}>
      <FieldLabel htmlFor={id}>Due in (days)</FieldLabel>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={DUE_IN_DAYS_MIN}
        max={DUE_IN_DAYS_MAX}
        className="h-11 bg-card"
        value={value}
        disabled={saving}
        aria-invalid={problem ? true : undefined}
        aria-describedby={problem ? `${id}-problem` : undefined}
        onChange={(event) => {
          setValue(event.target.value);
          setProblem(null);
        }}
        onBlur={() => void commit()}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void commit();
          }
        }}
      />
      {problem ? (
        <FieldError id={`${id}-problem`}>{problem}</FieldError>
      ) : (
        <FieldDescription>Saves when you leave the box. 0 means due the same day.</FieldDescription>
      )}
    </Field>
  );
}
