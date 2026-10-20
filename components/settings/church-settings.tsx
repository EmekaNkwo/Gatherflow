"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useChurchSettings } from "@/hooks/useChurchSettings";
import { DEFAULT_COUNTRY_CALLING_CODE, isCallingCode } from "@/lib/phone";
import { checkDueInDays, DUE_IN_DAYS_MAX, DUE_IN_DAYS_MIN } from "@/services/settings/due-in-days";
import { EmailDeliveryCard } from "./email-delivery-card";
import { DisclosureButton, SettingsPanel } from "./settings-panel";

type ChurchSettings = ReturnType<typeof useChurchSettings>;

/** The Church tab: name and defaults, the weekly services, email, and the limits behind reports. */
export function ChurchSettings({ settings }: { settings: ChurchSettings }) {
  return (
    <div className="space-y-6">
      <ProfileForm settings={settings} />
      <ServicesPanel settings={settings} />
      <EmailDeliveryCard />
      <LimitsPanel settings={settings} />
    </div>
  );
}

/** Mirrors the server's limit on a name. */
const CHURCH_NAME_MAX_LENGTH = 80;

function ProfileForm({ settings }: { settings: ChurchSettings }) {
  const [churchName, setChurchName] = useState(settings.settings.churchName);
  // Kept as typed: an empty box is a missing answer, not 0 ("due today").
  const [dueInDays, setDueInDays] = useState(String(settings.settings.defaultFollowUpDueInDays));
  const [callingCode, setCallingCode] = useState(
    `+${settings.settings.defaultCountryCallingCode ?? DEFAULT_COUNTRY_CALLING_CODE}`,
  );
  const [problems, setProblems] = useState<{ name?: string; due?: string; code?: string }>({});
  const [saving, setSaving] = useState(false);

  async function save() {
    if (saving) return;
    const due = checkDueInDays(dueInDays);
    const code = callingCode.trim().replace(/^\+/, "");
    const found = {
      name: churchName.trim() ? undefined : "Give the church a name.",
      due: due.ok ? undefined : due.error,
      code: isCallingCode(code) ? undefined : "Use one to three digits, such as +44 or +234.",
    };
    setProblems(found);
    if (found.name || found.due || found.code || !due.ok) return;
    setSaving(true);
    await settings.saveProfile({
      churchName: churchName.trim(),
      defaultFollowUpDueInDays: due.value,
      defaultCountryCallingCode: code,
    });
    setSaving(false);
  }

  return (
    <SettingsPanel title="Your church" description="The name appears in messages, invitations, the welcome page and at the top of pages.">
      <form
        className="space-y-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <Field className="max-w-md" data-invalid={problems.name ? true : undefined}>
          <FieldLabel htmlFor="church-name">Church name</FieldLabel>
          <Input
            id="church-name"
            className="h-11"
            value={churchName}
            maxLength={CHURCH_NAME_MAX_LENGTH}
            aria-invalid={problems.name ? true : undefined}
            onChange={(event) => setChurchName(event.target.value)}
          />
          {problems.name ? (
            <FieldError>{problems.name}</FieldError>
          ) : (
            <FieldDescription>
              {churchName.length} of {CHURCH_NAME_MAX_LENGTH} characters.
            </FieldDescription>
          )}
        </Field>
        <Field className="max-w-xs" data-invalid={problems.due ? true : undefined}>
          <FieldLabel htmlFor="default-due">New follow-ups are due in (days)</FieldLabel>
          <Input
            id="default-due"
            type="number"
            inputMode="numeric"
            min={DUE_IN_DAYS_MIN}
            max={DUE_IN_DAYS_MAX}
            className="h-11"
            value={dueInDays}
            aria-invalid={problems.due ? true : undefined}
            onChange={(event) => setDueInDays(event.target.value)}
          />
          {problems.due ? (
            <FieldError>{problems.due}</FieldError>
          ) : (
            <FieldDescription>For follow-ups someone adds by hand. 0 means the same day.</FieldDescription>
          )}
        </Field>
        <Field className="max-w-xs" data-invalid={problems.code ? true : undefined}>
          <FieldLabel htmlFor="calling-code">Country calling code</FieldLabel>
          <Input
            id="calling-code"
            className="h-11"
            inputMode="tel"
            maxLength={4}
            value={callingCode}
            aria-invalid={problems.code ? true : undefined}
            onChange={(event) => setCallingCode(event.target.value)}
          />
          {problems.code ? (
            <FieldError>{problems.code}</FieldError>
          ) : (
            <FieldDescription>
              Used for phone numbers saved without one, such as 07700 900123, so WhatsApp reaches the right person.
            </FieldDescription>
          )}
        </Field>
        <Button type="submit" size="lg" className="rounded-full" disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </form>
    </SettingsPanel>
  );
}

function ServicesPanel({ settings }: { settings: ChurchSettings }) {
  const running = settings.services.filter((service) => service.active).length;
  return (
    <SettingsPanel
      title="Services"
      description="Your usual weekly pattern, which a new church starts with as a suggestion. Switch off any you don't hold. Each service still needs adding for a date in Check-in."
    >
      <ul className="-mx-5 divide-y border-y md:-mx-6">
        {settings.services.map((service) => {
          // At least one service stays on, so check-in always has a pattern to offer.
          const lastRunning = service.active && running === 1;
          return (
            <li key={service.id} className="flex min-h-14 items-center justify-between gap-3 px-5 py-3 md:px-6">
              <div>
                <p className="font-medium">{service.name}</p>
                <p className="text-sm text-muted-foreground">
                  {service.weekday.charAt(0).toUpperCase() + service.weekday.slice(1)} at {service.time}
                  {lastRunning ? " · keep at least one service on" : ""}
                </p>
              </div>
              <Switch
                checked={service.active}
                disabled={lastRunning}
                onCheckedChange={(checked) =>
                  settings.saveServices(
                    settings.services.map((entry) =>
                      entry.id === service.id ? { ...entry, active: checked === true } : entry,
                    ),
                  )
                }
                aria-label={`${service.name} active`}
              />
            </li>
          );
        })}
      </ul>
    </SettingsPanel>
  );
}

/**
 * The thresholds behind reports and when follow-up stops. Rarely changed,
 * so they read as a sentence first and open into a form on request.
 */
function LimitsPanel({ settings }: { settings: ChurchSettings }) {
  const engagement = settings.settings.engagement;
  const [open, setOpen] = useState(false);
  const [inactiveWeeks, setInactiveWeeks] = useState(engagement.inactiveAfterWeeksAbsent);
  const [averageWeeks, setAverageWeeks] = useState(engagement.attendanceAverageWeeks);
  const [maxAttempts, setMaxAttempts] = useState(engagement.maxContactAttempts);

  return (
    <SettingsPanel
      title="When to step back"
      description="These limits are printed beside the figures they produce, so a report can always say why someone appears in it."
    >
      <p className="max-w-2xl">
        Someone is flagged for review after {engagement.inactiveAfterWeeksAbsent} weeks with no recorded attendance.
        Attendance is averaged over {engagement.attendanceAverageWeeks} weeks. Follow-up stops after{" "}
        {engagement.maxContactAttempts} tries with no answer.
      </p>
      <DisclosureButton open={open} onToggle={() => setOpen((value) => !value)} controls="engagement-limits">
        Change these limits
      </DisclosureButton>
      {open ? (
        <form
          id="engagement-limits"
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            settings.saveEngagement({
              inactiveAfterWeeksAbsent: inactiveWeeks,
              attendanceAverageWeeks: averageWeeks,
              maxContactAttempts: maxAttempts,
            });
          }}
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <Field>
              <FieldLabel htmlFor="inactive-weeks">Flag for review after (weeks)</FieldLabel>
              <Input
                id="inactive-weeks"
                type="number"
                min={1}
                max={52}
                className="h-11"
                value={inactiveWeeks}
                onChange={(event) => setInactiveWeeks(Number(event.target.value))}
              />
              <FieldDescription>Nobody&apos;s status changes on its own.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="average-weeks">Average attendance over (weeks)</FieldLabel>
              <Input
                id="average-weeks"
                type="number"
                min={1}
                max={52}
                className="h-11"
                value={averageWeeks}
                onChange={(event) => setAverageWeeks(Number(event.target.value))}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="max-attempts">Tries before follow-up stops</FieldLabel>
              <Input
                id="max-attempts"
                type="number"
                min={1}
                max={10}
                className="h-11"
                value={maxAttempts}
                onChange={(event) => setMaxAttempts(Number(event.target.value))}
              />
              <FieldDescription>The record is then closed as &ldquo;no response&rdquo;.</FieldDescription>
            </Field>
          </div>
          <Button type="submit" size="lg" className="rounded-full">
            Save limits
          </Button>
        </form>
      ) : null}
    </SettingsPanel>
  );
}
