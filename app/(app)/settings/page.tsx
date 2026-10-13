"use client";

import { useRef, useState } from "react";
import { DownloadIcon, RotateCcwIcon, ShieldAlertIcon, UploadIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { RestrictedState } from "@/components/shared/empty-state";
import { PageHeader, PageShell, Section } from "@/components/shared/page-header";
import {
  AUTOMATION_RULE_DESCRIPTIONS,
  AUTOMATION_RULE_LABELS,
} from "@/types/settings";
import { DEMO_ROLE_LABELS } from "@/types/team";
import { useChurchSettings } from "@/hooks/useChurchSettings";
import { useDemoRole } from "@/hooks/useDemoRole";

/** Church configuration, the automation rules, the team and the demo data. */
export default function SettingsPage() {
  const { can } = useDemoRole();
  const settings = useChurchSettings();
  const fileInput = useRef<HTMLInputElement>(null);

  const [churchName, setChurchName] = useState(settings.settings.churchName);
  const [dueInDays, setDueInDays] = useState(settings.settings.defaultFollowUpDueInDays);
  const [inactiveWeeks, setInactiveWeeks] = useState(
    settings.settings.engagement.inactiveAfterWeeksAbsent,
  );
  const [averageWeeks, setAverageWeeks] = useState(
    settings.settings.engagement.attendanceAverageWeeks,
  );
  const [maxAttempts, setMaxAttempts] = useState(
    settings.settings.engagement.maxContactAttempts,
  );
  const [resetting, setResetting] = useState(false);

  if (!can("settings.write")) {
    return (
      <PageShell>
        <RestrictedState section="Settings" />
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PageHeader
        title="Settings"
        description="How this church works: its services, its follow-up pipeline, the rules that create tasks, and the criteria behind its reports."
      />

      <Tabs defaultValue="church">
        <TabsList>
          <TabsTrigger value="church">Church</TabsTrigger>
          <TabsTrigger value="automation">Automation</TabsTrigger>
          <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
          <TabsTrigger value="team">Team</TabsTrigger>
          <TabsTrigger value="data">Demo data</TabsTrigger>
        </TabsList>

        <TabsContent value="church" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Church profile</CardTitle>
              <CardDescription>Used in message templates and page headings.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Field className="max-w-md">
                <FieldLabel htmlFor="church-name">Church name</FieldLabel>
                <Input
                  id="church-name"
                  value={churchName}
                  onChange={(event) => setChurchName(event.target.value)}
                />
              </Field>
              <Field className="max-w-xs">
                <FieldLabel htmlFor="default-due">Default follow-up window (days)</FieldLabel>
                <Input
                  id="default-due"
                  type="number"
                  min={0}
                  max={90}
                  value={dueInDays}
                  onChange={(event) => setDueInDays(Number(event.target.value))}
                />
                <FieldDescription>
                  How far ahead a manually created task is due by default.
                </FieldDescription>
              </Field>
              <Button
                size="sm"
                onClick={() =>
                  settings.saveProfile({ churchName, defaultFollowUpDueInDays: dueInDays })
                }
              >
                Save profile
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Engagement criteria</CardTitle>
              <CardDescription>
                These thresholds are printed next to the figures they produce, so a report can
                always explain why somebody appears in it.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <Field>
                  <FieldLabel htmlFor="inactive-weeks">Flag for review after (weeks)</FieldLabel>
                  <Input
                    id="inactive-weeks"
                    type="number"
                    min={1}
                    max={52}
                    value={inactiveWeeks}
                    onChange={(event) => setInactiveWeeks(Number(event.target.value))}
                  />
                  <FieldDescription>
                    Consecutive weeks with no recorded attendance. Nobody is reclassified
                    automatically.
                  </FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="average-weeks">Attendance average window</FieldLabel>
                  <Input
                    id="average-weeks"
                    type="number"
                    min={1}
                    max={52}
                    value={averageWeeks}
                    onChange={(event) => setAverageWeeks(Number(event.target.value))}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="max-attempts">Contact attempts before stopping</FieldLabel>
                  <Input
                    id="max-attempts"
                    type="number"
                    min={1}
                    max={10}
                    value={maxAttempts}
                    onChange={(event) => setMaxAttempts(Number(event.target.value))}
                  />
                  <FieldDescription>
                    After this many unanswered attempts, follow-up stops and the record is closed
                    as &ldquo;no response&rdquo;.
                  </FieldDescription>
                </Field>
              </div>
              <Button
                size="sm"
                onClick={() =>
                  settings.saveEngagement({
                    inactiveAfterWeeksAbsent: inactiveWeeks,
                    attendanceAverageWeeks: averageWeeks,
                    maxContactAttempts: maxAttempts,
                  })
                }
              >
                Save criteria
              </Button>
            </CardContent>
          </Card>

          <Section title="Services" description="The weekly pattern used across the app.">
            <ul className="grid gap-2 sm:grid-cols-2">
              {settings.services.map((service) => (
                <li
                  key={service.id}
                  className="flex items-center justify-between gap-2 rounded-lg border p-3 text-sm"
                >
                  <div>
                    <p className="font-medium">{service.name}</p>
                    <p className="text-xs text-muted-foreground capitalize">
                      {service.weekday} · {service.time}
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
          </Section>
        </TabsContent>

        <TabsContent value="automation" className="space-y-4">
          <Alert>
            <ShieldAlertIcon />
            <AlertTitle>How automation behaves here</AlertTitle>
            <AlertDescription>
              Rules react to things that actually happened — a visitor registered, somebody
              returned, a task was completed — and every generated task carries a key that makes
              creating it twice impossible. Nothing is ever created for a person who has asked not
              to be contacted.
            </AlertDescription>
          </Alert>

          <div className="grid gap-4 lg:grid-cols-2">
            {settings.rules.map((rule) => (
              <Card key={rule.id}>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between gap-2 text-base">
                    {AUTOMATION_RULE_LABELS[rule.id]}
                    <Switch
                      checked={rule.enabled}
                      onCheckedChange={(checked) =>
                        settings.saveRule(rule.id, { enabled: checked === true })
                      }
                      aria-label={`${AUTOMATION_RULE_LABELS[rule.id]} enabled`}
                    />
                  </CardTitle>
                  <CardDescription>{AUTOMATION_RULE_DESCRIPTIONS[rule.id]}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {rule.id !== "overdue_alert" ? (
                    <>
                      <Field className="max-w-[12rem]">
                        <FieldLabel htmlFor={`${rule.id}-due`}>Due in (days)</FieldLabel>
                        <Input
                          id={`${rule.id}-due`}
                          type="number"
                          min={0}
                          max={90}
                          value={rule.dueInDays}
                          onChange={(event) =>
                            settings.saveRule(rule.id, { dueInDays: Number(event.target.value) })
                          }
                        />
                      </Field>
                      <Field className="max-w-xs">
                        <FieldLabel htmlFor={`${rule.id}-assignee`}>Assign to</FieldLabel>
                        <NativeSelect
                          className="w-full"
                          id={`${rule.id}-assignee`}
                          value={rule.defaultAssigneeId ?? ""}
                          onChange={(event) =>
                            settings.saveRule(rule.id, {
                              defaultAssigneeId: event.target.value || undefined,
                            })
                          }
                        >
                          <NativeSelectOption value="">Leave unassigned</NativeSelectOption>
                          {settings.team
                            .filter((member) => member.active && member.role !== "member")
                            .map((member) => (
                              <NativeSelectOption key={member.id} value={member.id}>
                                {member.name}
                              </NativeSelectOption>
                            ))}
                        </NativeSelect>
                      </Field>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Overdue work is derived from due dates whenever it is displayed, so there is
                      nothing stored that could fall out of step.
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="pipeline" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Follow-up pipeline</CardTitle>
              <CardDescription>
                The stages visitors move through. A stage still holding visitors cannot be removed
                — they would lose their place.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ol className="space-y-2">
                {settings.stages.map((stage, index) => (
                  <li
                    key={stage.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
                  >
                    <div>
                      <p className="text-sm font-medium">
                        {index + 1}. {stage.name}
                      </p>
                      <p className="text-xs text-muted-foreground">{stage.description}</p>
                    </div>
                    <Badge variant={stage.kind === "terminal" ? "outline" : "secondary"}>
                      {stage.kind === "terminal" ? "Terminal" : "Active"}
                    </Badge>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="team" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Team</CardTitle>
              <CardDescription>
                Inactive members keep their history but cannot be given new work.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {settings.team.map((member) => (
                  <li
                    key={member.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
                  >
                    <div>
                      <p className="text-sm font-medium">{member.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {DEMO_ROLE_LABELS[member.role]}
                        {member.title ? ` · ${member.title}` : ""}
                      </p>
                    </div>
                    <Switch
                      checked={member.active}
                      onCheckedChange={(checked) =>
                        settings.setMemberActive(member.id, checked === true)
                      }
                      aria-label={`${member.name} active`}
                    />
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="data" className="space-y-4">
          <Alert>
            <ShieldAlertIcon />
            <AlertTitle>Everything lives in this browser</AlertTitle>
            <AlertDescription>
              GatherFlow has no backend. All records are synthetic and stored in this browser&apos;s
              local storage. Exports deliberately leave out pastoral-care records and emergency
              contacts.
            </AlertDescription>
          </Alert>

          <Card>
            <CardHeader>
              <CardTitle>Demo data</CardTitle>
              <CardDescription>
                {settings.seeded
                  ? "This browser was seeded with a fresh synthetic church."
                  : "Working from the data saved in this browser."}
                {settings.report?.issues.length
                  ? ` ${settings.report.issues.join(" ")}`
                  : ""}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={settings.downloadBundle}
              >
                <DownloadIcon />
                Export demo data
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => fileInput.current?.click()}
              >
                <UploadIcon />
                Import demo data
              </Button>
              <input
                ref={fileInput}
                type="file"
                accept="application/json"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void settings.uploadBundle(file);
                  event.target.value = "";
                }}
              />
              <Button
                variant="destructive"
                size="sm"
                className="gap-1.5"
                onClick={() => setResetting(true)}
              >
                <RotateCcwIcon />
                Restore the original demo data
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={resetting}
        onOpenChange={setResetting}
        title="Restore the original demo data?"
        description="Everything recorded in this browser is replaced with a freshly generated church. This cannot be undone."
        confirmLabel="Restore demo data"
        destructive
        onConfirm={settings.resetDemoData}
      />
    </PageShell>
  );
}
