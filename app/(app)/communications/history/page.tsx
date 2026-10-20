"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { SlidersHorizontalIcon } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState, NoResultsState, RestrictedState } from "@/components/shared/empty-state";
import { PageHeader, PageShell } from "@/components/shared/page-header";
import { SelectField, type SelectOption } from "@/components/shared/select-field";
import { personHref } from "@/components/shared/person-cell";
import { formatDisplayDateTime } from "@/lib/dates";
import { displayName, normalise } from "@/lib/strings";
import { CONTACT_METHOD_LABELS } from "@/types/common";
import { COMMUNICATION_STATUS_LABELS, type CommunicationStatus } from "@/types/communication";
import { summariseHistory } from "@/services/communications/messaging";
import { useCommunications } from "@/hooks/useCommunications";
import { useRole } from "@/hooks/useRole";

const PAGE_SIZE = 50;

const STATUS_OPTIONS: SelectOption[] = [
  { value: "", label: "Anything that happened" },
  ...(Object.keys(COMMUNICATION_STATUS_LABELS) as CommunicationStatus[]).map((option) => ({
    value: option,
    label: COMMUNICATION_STATUS_LABELS[option],
  })),
];

/** Reached them, as far as anyone can tell. */
const GOOD: readonly CommunicationStatus[] = ["delivered"];
/** Did not reach them; worth a look. */
const PROBLEM: readonly CommunicationStatus[] = ["bounced", "blocked", "spam", "failed"];

function tone(status: CommunicationStatus): string {
  if (GOOD.includes(status)) return "bg-done";
  if (PROBLEM.includes(status)) return "bg-destructive";
  return "bg-muted-foreground/40";
}

/**
 * Sent messages, person first: who it was for, then what happened to it in
 * plain words. GatherFlow cannot see inside WhatsApp or a phone, so for those
 * it only records what the sender did, and never claims delivery.
 */
export default function CommunicationHistoryPage() {
  const { can } = useRole();
  const { history } = useCommunications();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<CommunicationStatus | "">("");
  const [moreFilters, setMoreFilters] = useState(false);
  const [limit, setLimit] = useState(PAGE_SIZE);

  const rows = useMemo(() => {
    const needle = normalise(search);
    return history.filter((entry) => {
      if (status && entry.entry.status !== status) return false;
      if (!needle) return true;
      return normalise(
        `${entry.person?.firstName ?? ""} ${entry.person?.lastName ?? ""} ${entry.entry.body}`,
      ).includes(needle);
    });
  }, [history, search, status]);

  if (!can("communications.write")) {
    return (
      <PageShell>
        <RestrictedState section="Communication history" />
      </PageShell>
    );
  }

  const summary = summariseHistory(history.map((item) => item.entry));
  const problems = history.filter((entry) => PROBLEM.includes(entry.entry.status)).length;
  const shown = rows.slice(0, limit);
  const filtered = Boolean(search || status);

  return (
    <PageShell className="max-w-4xl">
      <PageHeader
        title="Sent messages"
        description="Every message prepared here, drafts included, and what happened to it. For WhatsApp, texts, calls and anything opened in your own email app we can only record what you did; for email the church sends, it is what the email provider told us."
      />

      {history.length ? (
        <p className="max-w-2xl text-lg">
          {summary}
          {problems ? ` ${problems} did not get through.` : ""}
        </p>
      ) : null}

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by name or words in the message"
            className="h-11 min-w-0 flex-1 rounded-full sm:max-w-80"
            aria-label="Search communication history"
          />
          <Button
            variant="ghost"
            className="min-h-11 rounded-full"
            aria-expanded={moreFilters}
            onClick={() => setMoreFilters((open) => !open)}
          >
            <SlidersHorizontalIcon />
            More filters
          </Button>
        </div>
        {moreFilters ? (
          <SelectField
            value={status}
            onValueChange={(value) => setStatus(value as CommunicationStatus | "")}
            aria-label="Filter by what happened"
            className="w-auto"
            options={STATUS_OPTIONS}
          />
        ) : null}
      </div>

      {shown.length ? (
        <>
          <ul className="divide-y overflow-hidden rounded-3xl border bg-card" aria-label="Communication history">
            {shown.map(({ entry, person, actor }) => (
              <li key={entry.id} className="min-h-14 space-y-1 px-5 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                  {person ? (
                    <Link href={personHref(person)} className="font-medium underline-offset-4 hover:underline">
                      {displayName(person)}
                    </Link>
                  ) : (
                    <span className="font-medium text-muted-foreground">Record deleted</span>
                  )}
                  <span className="text-sm text-muted-foreground">{formatDisplayDateTime(entry.at)}</span>
                </div>
                <p className="flex items-center gap-2 text-sm">
                  <span aria-hidden className={cn("size-2 shrink-0 rounded-full", tone(entry.status))} />
                  <span className={cn(PROBLEM.includes(entry.status) && "text-destructive")}>
                    {COMMUNICATION_STATUS_LABELS[entry.status]}
                  </span>
                  <span className="text-muted-foreground">
                    · {CONTACT_METHOD_LABELS[entry.channel]}
                    {actor ? ` · by ${actor.name}` : ""}
                  </span>
                </p>
                <p className="line-clamp-1 text-sm text-muted-foreground">{entry.body}</p>
              </li>
            ))}
          </ul>
          {rows.length > shown.length ? (
            <Button variant="ghost" className="min-h-11 rounded-full" onClick={() => setLimit((value) => value + PAGE_SIZE)}>
              Show more ({rows.length - shown.length} left)
            </Button>
          ) : null}
        </>
      ) : filtered ? (
        <NoResultsState
          context="messages"
          onClear={
            <Button
              variant="outline"
              className="min-h-11 rounded-full"
              onClick={() => {
                setSearch("");
                setStatus("");
              }}
            >
              Clear filters
            </Button>
          }
        />
      ) : (
        <EmptyState
          title="No messages yet"
          description="Prepare a message from someone's page and it will show here."
        />
      )}
    </PageShell>
  );
}
