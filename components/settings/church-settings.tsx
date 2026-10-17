"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useChurchSettings } from "@/hooks/useChurchSettings";
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

function ProfileForm({ settings }: { settings: ChurchSettings }) {
  const [churchName, setChurchName] = useState(settings.settings.churchName);
  const [dueInDays, setDueInDays] = useState(settings.settings.defaultFollowUpDueInDays);

  return (
    <SettingsPanel title="Your church" description="The name appears in messages and at the top of pages.">
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          settings.saveProfile({ churchName, defaultFollowUpDueInDays: dueInDays });
        }}
      >
        <Field className="max-w-md">
          <FieldLabel htmlFor="church-name">Church name</FieldLabel>
          <Input id="church-name" className="h-11" value={churchName} onChange={(event) => setChurchName(event.target.value)} />
        </Field>
        <Field className="max-w-xs">
          <FieldLabel htmlFor="default-due">New follow-ups are due in (days)</FieldLabel>
          <Input
            id="default-due"
            type="number"
            min={0}
            max={90}
            className="h-11"
            value={dueInDays}
            onChange={(event) => setDueInDays(Number(event.target.value))}
          />
          <FieldDescription>For follow-ups someone adds by hand.</FieldDescription>
        </Field>
        <Button type="submit" size="lg" className="rounded-full">
          Save
        </Button>
      </form>
    </SettingsPanel>
  );
}

function ServicesPanel({ settings }: { settings: ChurchSettings }) {
  return (
    <SettingsPanel title="Services" description="Your weekly pattern. Switch off a service you no longer hold.">
      <ul className="-mx-5 divide-y border-y md:-mx-6">
        {settings.services.map((service) => (
          <li key={service.id} className="flex min-h-14 items-center justify-between gap-3 px-5 py-3 md:px-6">
            <div>
              <p className="font-medium">{service.name}</p>
              <p className="text-sm text-muted-foreground">
                {service.weekday.charAt(0).toUpperCase() + service.weekday.slice(1)} at {service.time}
              </p>
            </div>
            <Switch
              checked={service.active}
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
        ))}
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
