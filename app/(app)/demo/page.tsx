"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2Icon, CircleIcon, SparklesIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LinkButton } from "@/components/shared/link-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader, PageShell, Section } from "@/components/shared/page-header";
import { toIsoDate } from "@/lib/dates";
import { useAttendance } from "@/hooks/useAttendance";
import { useCommunications } from "@/hooks/useCommunications";
import { useDemoRole } from "@/hooks/useDemoRole";
import { useFollowUps } from "@/hooks/useFollowUps";
import { useGroups } from "@/hooks/useGroups";
import { useMembers } from "@/hooks/useMembers";
import { useNow } from "@/hooks/use-now";
import { useSnapshot } from "@/hooks/use-church-data";
import { useVisitors } from "@/hooks/useVisitors";

interface StepResult {
  index: number;
  message: string;
  ok: boolean;
}

/**
 * The guided demonstration.
 *
 * Every step runs the same command the interface runs — there is no scripted
 * animation here. The records it creates are real, and stay in the browser
 * until the demo data is restored from Settings.
 */
export default function GuidedDemoPage() {
  const now = useNow();
  const snapshot = useSnapshot();
  const { assignableTeam } = useDemoRole();

  const visitors = useVisitors();
  const followUps = useFollowUps();
  const attendance = useAttendance();
  const members = useMembers();
  const groups = useGroups();
  const communications = useCommunications();

  const [personId, setPersonId] = useState<string | null>(null);
  const [results, setResults] = useState<StepResult[]>([]);
  const [step, setStep] = useState(0);

  const record = (index: number, ok: boolean, message: string) => {
    setResults((previous) => [...previous.filter((entry) => entry.index !== index), { index, ok, message }]);
    if (ok) setStep(index + 1);
  };

  const person = personId ? snapshot.people.find((entry) => entry.id === personId) : undefined;
  const openTask = personId
    ? snapshot.tasks.find(
        (task) =>
          task.personId === personId &&
          ["pending", "in_progress", "rescheduled"].includes(task.status),
      )
    : undefined;

  const latestSession = [...snapshot.sessions]
    .filter((session) => session.date <= toIsoDate(now))
    .sort((left, right) => (left.date < right.date ? 1 : -1))[0];
  const connectGroup = snapshot.groups.find(
    (group) => group.active && group.type === "connect_group",
  );

  const steps: Array<{
    title: string;
    detail: string;
    action: () => void | Promise<void>;
    disabled?: boolean;
  }> = [
    {
      title: "Register a first-time visitor",
      detail:
        "Creates a visitor record and records their attendance at the most recent service, so the visit count comes from a real attendance row.",
      action: async () => {
        const outcome = await visitors.register({
          firstName: "Testimony",
          lastName: `Demo${snapshot.people.length}`,
          phone: "+44 7700 900321",
          visitDate: latestSession?.date ?? toIsoDate(now),
          sessionId: latestSession?.id,
          source: "invitation",
          preferredMethod: "whatsapp",
          permissionGranted: true,
        });
        if (outcome.ok) {
          setPersonId(outcome.value.personId);
          record(0, true, `${outcome.value.notices.join(" ")}`);
        } else {
          record(0, false, outcome.error);
        }
      },
    },
    {
      title: "Assign a follow-up volunteer",
      detail:
        "Assigning somebody moves the visitor to “contact pending” and moves their open tasks with them.",
      disabled: !personId,
      action: async () => {
        if (!personId) return;
        const outcome = await visitors.assign(personId, assignableTeam[0]?.id);
        record(1, outcome.ok, outcome.ok ? outcome.value.notices.join(" ") : outcome.error);
      },
    },
    {
      title: "Draft the welcome message",
      detail:
        "Prepares the first-time visitor welcome from the template and records it as a draft. Nothing is sent — GatherFlow has no backend to send with.",
      disabled: !personId,
      action: async () => {
        if (!person) return;
        const template = snapshot.templates.find(
          (entry) => entry.category === "visitor_welcome",
        );
        if (!template) return record(2, false, "No welcome template is configured.");
        const prepared = communications.prepare({
          personId: person.id,
          templateId: template.id,
        });
        if (!prepared.ok) return record(2, false, prepared.error);
        const outcome = await communications.log({
          personId: person.id,
          channel: prepared.value.channel,
          status: "drafted",
          body: prepared.value.body,
          templateId: template.id,
        });
        record(2, outcome.ok, outcome.ok ? "Welcome message drafted and logged." : outcome.error);
      },
    },
    {
      title: "Record a successful follow-up",
      detail:
        "Completing the welcome task with “successfully contacted” moves the visitor along the pipeline and creates the natural next action.",
      disabled: !openTask,
      action: async () => {
        if (!openTask) return record(3, false, "There is no open task to complete.");
        const outcome = await followUps.complete(openTask.id, "contacted", "Spoke on the phone.");
        record(3, outcome.ok, outcome.ok ? outcome.value.notices.join(" ") : outcome.error);
      },
    },
    {
      title: "Record their next visit",
      detail:
        "A second attendance record triggers the return-visit rule: the journey moves to “Returned” and the next action is reviewed.",
      disabled: !personId,
      action: async () => {
        if (!personId) return;
        const target = snapshot.sessions.find(
          (session) =>
            session.id !== latestSession?.id &&
            !snapshot.attendance.some(
              (row) => row.sessionId === session.id && row.personId === personId,
            ),
        );
        if (!target) return record(4, false, "No other session is available to check them in to.");
        const outcome = await attendance.checkIn(target.id, personId, "search");
        record(4, outcome.ok, outcome.ok ? outcome.value.notices.join(" ") : outcome.error);
      },
    },
    {
      title: "Record membership interest",
      detail:
        "Asking about membership creates an orientation task for the administrator — once, however many times the event is replayed.",
      disabled: !personId,
      action: async () => {
        if (!personId) return;
        const outcome = await visitors.expressMembershipInterest(personId);
        record(5, outcome.ok, outcome.ok ? outcome.value.notices.join(" ") : outcome.error);
      },
    },
    {
      title: "Register them as a member",
      detail:
        "The same person id is kept, so their attendance, follow-up history and timeline all carry over.",
      disabled: !personId,
      action: async () => {
        if (!personId) return;
        const outcome = await members.register({ personId, membershipDate: toIsoDate(now) });
        record(6, outcome.ok, outcome.ok ? outcome.value.notices.join(" ") : outcome.error);
      },
    },
    {
      title: "Add them to a connect group",
      detail:
        "Group membership is always an explicit action, recorded against the person who made it. This also marks the visitor journey as connected.",
      disabled: !personId || !connectGroup,
      action: async () => {
        if (!personId || !connectGroup) return;
        const outcome = await groups.addMember(connectGroup.id, personId);
        record(7, outcome.ok, outcome.ok ? outcome.value.notices.join(" ") : outcome.error);
      },
    },
  ];

  return (
    <PageShell>
      <PageHeader
        title="Guided demonstration"
        description="Walk the journey from first visit to connected member. Every step runs the real command and changes the real records."
        actions={
          person ? (
            <LinkButton size="sm" href={person.member ? `/members/${person.id}` : `/visitors/${person.id}`}>
              Open the record
            </LinkButton>
          ) : null
        }
      />

      <Alert>
        <SparklesIcon />
        <AlertTitle>Nothing here is pre-scripted</AlertTitle>
        <AlertDescription>
          Each button calls the same service the interface calls. If a step is refused — because
          somebody opted out, or a task was already created — you will see the real refusal.
          Restore the original data any time from Settings.
        </AlertDescription>
      </Alert>

      <ol className="space-y-3">
        {steps.map((entry, index) => {
          const result = results.find((item) => item.index === index);
          const current = index === step;
          return (
            <li key={entry.title}>
              <Card className={current ? "border-primary/60" : undefined}>
                <CardHeader>
                  <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                    {result?.ok ? (
                      <CheckCircle2Icon className="size-4 text-emerald-600 dark:text-emerald-500" />
                    ) : (
                      <CircleIcon className="size-4 text-muted-foreground" />
                    )}
                    {index + 1}. {entry.title}
                    {current ? <Badge variant="secondary">Next</Badge> : null}
                  </CardTitle>
                  <CardDescription>{entry.detail}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  <Button
                    size="sm"
                    variant={current ? "default" : "outline"}
                    disabled={entry.disabled}
                    onClick={() => void entry.action()}
                  >
                    Run this step
                  </Button>
                  {result ? (
                    <p
                      className={
                        result.ok
                          ? "text-sm text-muted-foreground"
                          : "text-sm text-destructive"
                      }
                    >
                      {result.message}
                    </p>
                  ) : null}
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ol>

      <Section
        title="See the awkward cases too"
        description="A demo that only shows the happy path is not much use."
      >
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <li>
            <Link
              href="/follow-ups/tasks?due=overdue"
              className="block rounded-xl border p-3 text-sm hover:bg-muted/50"
            >
              <p className="font-medium">Overdue follow-up</p>
              <p className="text-xs text-muted-foreground">
                Work that has slipped, and what the dashboard does about it.
              </p>
            </Link>
          </li>
          <li>
            <Link
              href="/visitors?filter=contact_declined"
              className="block rounded-xl border p-3 text-sm hover:bg-muted/50"
            >
              <p className="font-medium">A visitor who opted out</p>
              <p className="text-xs text-muted-foreground">
                No tasks, no drafts, and the record kept so nobody asks again.
              </p>
            </Link>
          </li>
          <li>
            <Link
              href="/members?filter=requested_contact"
              className="block rounded-xl border p-3 text-sm hover:bg-muted/50"
            >
              <p className="font-medium">A member who asked for contact</p>
              <p className="text-xs text-muted-foreground">
                Surfaced on the dashboard until somebody picks it up.
              </p>
            </Link>
          </li>
          <li>
            <Link
              href="/members?filter=needs_review"
              className="block rounded-xl border p-3 text-sm hover:bg-muted/50"
            >
              <p className="font-medium">Members flagged for review</p>
              <p className="text-xs text-muted-foreground">
                Shown with the criterion that flagged them. No status changes automatically.
              </p>
            </Link>
          </li>
          <li>
            <Link href="/reports" className="block rounded-xl border p-3 text-sm hover:bg-muted/50">
              <p className="font-medium">The effect on the figures</p>
              <p className="text-xs text-muted-foreground">
                Every rate recounted from the records you just changed.
              </p>
            </Link>
          </li>
          <li>
            <Link
              href="/pastoral-care"
              className="block rounded-xl border p-3 text-sm hover:bg-muted/50"
            >
              <p className="font-medium">Restricted pastoral care</p>
              <p className="text-xs text-muted-foreground">
                Switch to the volunteer role in the header and watch it disappear.
              </p>
            </Link>
          </li>
        </ul>
      </Section>
    </PageShell>
  );
}
