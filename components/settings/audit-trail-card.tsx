"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { cn } from "cn";
import { formatDisplayDateTime } from "@/lib/dates";
import { fetchAudit, type AuditEntry } from "@/services/commands/client";
import { useSnapshot } from "@/hooks/use-church-data";
import { SettingsPanel } from "./settings-panel";

/**
 * What the server recorded about who did what. Remote mode only: in the
 * timeline on each record is the church's own history; this is the server's.
 */
export function AuditTrailCard() {
  const snapshot = useSnapshot();
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetchAudit(controller.signal).then((outcome) => {
      if (controller.signal.aborted) return;
      if (outcome.ok) setEntries(outcome.value.entries);
      else setError(outcome.error);
    });
    return () => controller.abort();
  }, []);

  const teamById = new Map(snapshot.team.map((member) => [member.id, member.name]));
  const peopleById = new Map(snapshot.people.map((person) => [person.id, person]));

  return (
    <SettingsPanel
      title="Who did what"
      description="Everything the server was asked to do in the last 90 days, including what it refused. It keeps names and outcomes only, never a message or a note."
    >
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {!entries && !error ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {entries && entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing has been recorded yet.</p>
      ) : null}
      {entries && entries.length > 0 ? (
        <ul className="-mx-5 divide-y border-y text-sm md:-mx-6">
          {entries.map((entry) => {
            const person = entry.targetId ? peopleById.get(entry.targetId) : undefined;
            const who =
              entry.userId === "system" ? "Email provider" : (teamById.get(entry.actorId ?? "") ?? "An account");
            return (
              <li key={entry.id} className="flex min-h-14 flex-col gap-1 px-5 py-3 sm:flex-row sm:items-center sm:gap-4 md:px-6">
                <div className="min-w-0 flex-1">
                  <p>
                    <span className="font-medium">{who}</span>
                    <span className="mx-1.5 text-muted-foreground">·</span>
                    <span className="font-mono text-xs">{entry.action}</span>
                  </p>
                  <p className="text-muted-foreground">
                    {person ? (
                      <Link
                        href={`/${person.kind === "member" ? "members" : "visitors"}/${person.id}`}
                        className="text-foreground underline-offset-4 hover:underline"
                      >
                        {person.firstName} {person.lastName}
                      </Link>
                    ) : entry.targetId ? (
                      <span className="font-mono text-xs">{entry.targetId}</span>
                    ) : null}
                    {entry.targetId ? " · " : ""}
                    {formatDisplayDateTime(entry.at)}
                  </p>
                </div>
                <span
                  className={cn(
                    "self-start rounded-full px-2.5 py-0.5 text-xs font-medium sm:self-center",
                    entry.outcome === "ok" ? "bg-muted text-muted-foreground" : "bg-destructive/10 text-destructive",
                  )}
                >
                  {entry.outcome === "ok" ? "Done" : entry.outcome === "refused" ? "Refused" : "Failed"}
                  {entry.outcome !== "ok" && entry.code ? ` · ${entry.code}` : ""}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </SettingsPanel>
  );
}
