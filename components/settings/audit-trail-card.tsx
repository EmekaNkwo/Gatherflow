"use client";

import { toast } from "sonner";
import { useEffect, useState } from "react";
import Link from "next/link";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { formatDisplayDateTime } from "@/lib/dates";
import { fetchAudit, type AuditEntry } from "@/services/commands/client";
import { useSnapshot } from "@/hooks/use-church-data";
import { describeAction, parseAuditTarget } from "@/services/settings/audit-labels";
import type { ChurchSnapshot } from "@/types/snapshot";
import { AUTOMATION_RULE_LABELS } from "@/types/settings";
import { DEMO_ROLE_LABELS, type DemoRole } from "@/types/team";
import { SettingsPanel } from "./settings-panel";

const OUTCOME_LABELS: Record<string, { label: string; problem: boolean }> = {
  ok: { label: "Done", problem: false },
  skipped: { label: "Skipped", problem: false },
  refused: { label: "Refused", problem: true },
  failed: { label: "Failed", problem: true },
};

/** Refusal codes in words; anything unlisted is shown with spaces. */
const CODE_LABELS: Record<string, string> = {
  forbidden: "not allowed",
  not_found: "no longer there",
  invalid: "not valid",
  invalid_input: "not valid",
  duplicate: "already exists",
  conflict: "someone else saved first",
  storage_failed: "could not be saved",
  transport: "could not be sent",
  already_member: "already a member",
  inactive: "person switched off",
};

interface TargetDescription {
  label: string | null;
  href?: string;
}

/**
 * Turns a stored target into a name: a person, team member, template, rule,
 * follow-up or service, plus any detail kept with it (such as a role). An id
 * nothing matches is shown as "a record that has since been removed" rather
 * than as a raw id.
 */
function targetDescriber(snapshot: ChurchSnapshot): (targetId: string | null) => TargetDescription {
  const people = new Map(snapshot.people.map((person) => [person.id, person]));
  const names = new Map<string, string>([
    ...snapshot.team.map((member) => [member.id, member.name] as const),
    ...snapshot.templates.map((template) => [template.id, `"${template.name}" template`] as const),
    ...snapshot.tasks.map((task) => [task.id, `Follow-up ${task.reference}`] as const),
    ...snapshot.sessions.map((session) => [session.id, session.name] as const),
    ...snapshot.groups.map((group) => [group.id, group.name] as const),
    ...Object.entries(AUTOMATION_RULE_LABELS),
  ]);

  return (targetId) => {
    const { id, detail } = parseAuditTarget(targetId);
    if (!id) return { label: null };
    const role = detail && detail in DEMO_ROLE_LABELS ? DEMO_ROLE_LABELS[detail as DemoRole] : detail;
    const suffix = role ? ` · as ${role.toLowerCase()}` : "";
    const person = people.get(id);
    if (person) {
      return {
        label: `${person.firstName} ${person.lastName}${suffix}`,
        href: `/${person.kind === "member" ? "members" : "visitors"}/${person.id}`,
      };
    }
    const named = names.get(id) ?? (id.includes("@") ? id : null);
    if (named) return { label: `${named}${suffix}` };
    // Long hashes and opaque ids mean nothing to a reader.
    return { label: role ? `Someone${suffix}` : "A record that has since been removed" };
  };
}

/**
 * What the server recorded about who did what. Remote mode only: in the
 * timeline on each record is the church's own history; this is the server's.
 */
export function AuditTrailCard() {
  const snapshot = useSnapshot();
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void fetchAudit(controller.signal).then((outcome) => {
      if (controller.signal.aborted) return;
      if (outcome.ok) setEntries(outcome.value.entries);
      else {
        setFailed(true);
        toast.error("Could not load who did what", { description: outcome.error });
      }
    });
    return () => controller.abort();
  }, []);

  const describeTarget = targetDescriber(snapshot);
  return (
    <SettingsPanel
      title="Who did what"
      description="Everything the server was asked to do in the last 90 days, including what it refused. It keeps names and outcomes only, never a message or a note."
    >
      {failed ? (
        <Button variant="outline" className="min-h-11 rounded-full" onClick={() => window.location.reload()}>
          Try again
        </Button>
      ) : null}
      {!entries && !failed ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {entries && entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing has been recorded yet.</p>
      ) : null}
      {entries && entries.length > 0 ? (
        <ul className="-mx-5 divide-y border-y text-sm md:-mx-6">
          {entries.map((entry) => {
            const target = describeTarget(entry.targetId);
            const who =
              entry.userId === "system"
                ? "Email provider"
                : (snapshot.team.find((member) => member.id === entry.actorId)?.name ?? "An account");
            const status = OUTCOME_LABELS[entry.outcome] ?? OUTCOME_LABELS.failed;
            return (
              <li key={entry.id} className="flex min-h-14 flex-col gap-1 px-5 py-3 sm:flex-row sm:items-center sm:gap-4 md:px-6">
                <div className="min-w-0 flex-1">
                  <p>
                    <span className="font-medium">{who}</span>
                    <span className="mx-1.5 text-muted-foreground">·</span>
                    <span>{describeAction(entry.action)}</span>
                  </p>
                  <p className="text-muted-foreground">
                    {target.href ? (
                      <Link href={target.href} className="text-foreground underline-offset-4 hover:underline">
                        {target.label}
                      </Link>
                    ) : target.label ? (
                      <span className="text-foreground">{target.label}</span>
                    ) : null}
                    {target.label ? " · " : ""}
                    {formatDisplayDateTime(entry.at)}
                  </p>
                </div>
                <span
                  className={cn(
                    "self-start rounded-full px-2.5 py-0.5 text-xs font-medium sm:self-center",
                    status.problem ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground",
                  )}
                >
                  {status.label}
                  {status.problem && entry.code ? ` · ${CODE_LABELS[entry.code] ?? entry.code.replace(/_/g, " ")}` : ""}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </SettingsPanel>
  );
}
