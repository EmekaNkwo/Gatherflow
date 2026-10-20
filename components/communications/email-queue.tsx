"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { CheckIcon, CopyIcon, ExternalLinkIcon, PencilIcon } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { displayName } from "@/lib/strings";
import type { PersonId } from "@/types/common";
import type { CommunicationLogEntry, MessageTemplate } from "@/types/communication";
import { createCommandContext } from "@/services/core/context";
import {
  buildMailto,
  MAILTO_MAX_LENGTH,
  personalDrafts,
  type EmailRecipient,
} from "@/services/communications/group-email";
import { gapsIn, placeholdersIn } from "@/services/communications/template-engine";
import { useCommunications } from "@/hooks/useCommunications";
import { useSnapshot } from "@/hooks/use-church-data";
import { useNow } from "@/hooks/use-now";
import { useSessionStore } from "@/stores/session-store";

interface EmailQueueProps {
  recipients: readonly EmailRecipient[];
  template: MessageTemplate;
  subject: string;
  groupName?: string;
}

/** How far back a "sent" record still marks somebody done in this list. */
const RECENT_MS = 12 * 60 * 60 * 1000;

/**
 * A personal email to each person, every placeholder filled with their own
 * details. Each is opened on its own — browsers allow one hand-over per tap —
 * and marked sent when the person says so. "Sent" comes from the record, so
 * leaving and coming back keeps everyone's place.
 */
export function EmailQueue({ recipients, template, subject, groupName }: EmailQueueProps) {
  const snapshot = useSnapshot();
  const now = useNow();
  const teamMemberId = useSessionStore((state) => state.teamMemberId);
  const { recordSentEmails } = useCommunications();

  const drafts = useMemo(
    () =>
      personalDrafts(
        snapshot,
        template.id,
        recipients.map((recipient) => recipient.person),
        createCommandContext({ actorId: teamMemberId ?? "", now }),
        groupName,
      ),
    [snapshot, template.id, recipients, teamMemberId, now, groupName],
  );

  const sent = useMemo(
    () => recentlySent(snapshot.communications, template.id, teamMemberId, now),
    [snapshot.communications, template.id, teamMemberId, now],
  );

  const [edits, setEdits] = useState<Readonly<Record<PersonId, string>>>({});
  /** Words typed once for a placeholder nobody's details could fill. */
  const [fills, setFills] = useState<Readonly<Record<string, string>>>({});
  const [editing, setEditing] = useState<PersonId | null>(null);
  const [awaiting, setAwaiting] = useState<PersonId | null>(null);
  const [busy, setBusy] = useState(false);

  // Gaps the drafts share, offered once instead of in every email.
  const unfilled = Array.from(new Set(drafts.flatMap((draft) => placeholdersIn(draft.body))));
  const bodyFor = (personId: PersonId, draftBody: string) => edits[personId] ?? fillIn(draftBody, fills);

  const next = recipients.find((recipient) => !sent.has(recipient.person.id))?.person.id;
  const doneCount = recipients.filter((recipient) => sent.has(recipient.person.id)).length;

  async function markSent(personId: PersonId, body: string) {
    if (busy) return;
    setBusy(true);
    const outcome = await recordSentEmails([{ personId, body }], template.id, { silent: true });
    setBusy(false);
    if (outcome.ok) setAwaiting(null);
  }

  async function copy(body: string) {
    try {
      await navigator.clipboard.writeText(body);
      toast.success("Message copied");
    } catch {
      toast.error("Could not reach the clipboard. Select the text and copy it yourself.");
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {doneCount === recipients.length
          ? "All sent. Thank you!"
          : `${doneCount} of ${recipients.length} sent. Open each one, send it, then come back here.`}
      </p>
      {unfilled.length ? (
        <div className="space-y-3 rounded-2xl bg-muted px-4 py-3">
          {unfilled.map((placeholder) => (
            <Field key={placeholder}>
              <FieldLabel htmlFor={`fill-${placeholder}`}>{PLACEHOLDER_LABELS[placeholder] ?? placeholder}</FieldLabel>
              <Input
                id={`fill-${placeholder}`}
                className="h-11 bg-background"
                value={fills[placeholder] ?? ""}
                maxLength={200}
                onChange={(event) => setFills((previous) => ({ ...previous, [placeholder]: event.target.value }))}
              />
              <FieldDescription>
                Some emails need this and we don&apos;t have it. Type it once and it goes into each of them.
              </FieldDescription>
            </Field>
          ))}
        </div>
      ) : null}

      <ul className="divide-y overflow-hidden rounded-3xl border bg-card">
        {recipients.map(({ person, email }) => {
          const draft = drafts.find((entry) => entry.personId === person.id);
          if (!draft) return null;
          const body = bodyFor(person.id, draft.body);
          const gaps = gapsIn(body);
          const link = buildMailto({ to: [email], subject, body });
          const linkFits = link.length <= MAILTO_MAX_LENGTH;
          const isSent = sent.has(person.id);
          const isNext = person.id === next;
          const name = displayName(person);

          return (
            <li key={person.id} className={cn("space-y-3 px-5 py-4", isSent && "bg-muted/40")}>
              <div className="flex flex-wrap items-center gap-3">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{name}</span>
                  <span className="block truncate text-sm text-muted-foreground">
                    {isSent ? "Sent" : gaps.length ? `Fill in ${gaps.join(", ")} first` : email}
                  </span>
                </span>
                {isSent ? (
                  <CheckIcon className="size-5 shrink-0 text-done" aria-label="Sent" />
                ) : (
                  <>
                    <Button
                      variant="ghost"
                      size="icon-lg"
                      aria-label={`Edit the email to ${name}`}
                      aria-expanded={editing === person.id}
                      onClick={() => setEditing((current) => (current === person.id ? null : person.id))}
                    >
                      <PencilIcon />
                    </Button>
                    {linkFits ? (
                      <Button
                        variant={isNext ? "default" : "outline"}
                        className="min-h-11 gap-1.5"
                        disabled={gaps.length > 0}
                        onClick={() => {
                          setAwaiting(person.id);
                          window.location.assign(link);
                        }}
                      >
                        <ExternalLinkIcon />
                        Open
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        className="min-h-11 gap-1.5"
                        disabled={gaps.length > 0}
                        onClick={() => {
                          setAwaiting(person.id);
                          void copy(body);
                        }}
                      >
                        <CopyIcon />
                        Copy
                      </Button>
                    )}
                  </>
                )}
              </div>

              {editing === person.id && !isSent ? (
                <Textarea
                  aria-label={`Email to ${name}`}
                  rows={6}
                  className="text-base"
                  value={body}
                  maxLength={5_000}
                  onChange={(event) => setEdits((previous) => ({ ...previous, [person.id]: event.target.value }))}
                />
              ) : null}

              {awaiting === person.id && !isSent ? (
                <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-muted px-4 py-3 text-sm">
                  <p className="flex-1">Did you send it to {person.firstName}?</p>
                  <Button className="min-h-11" disabled={busy} onClick={() => void markSent(person.id, body)}>
                    Yes, sent
                  </Button>
                  <Button variant="ghost" className="min-h-11" onClick={() => setAwaiting(null)}>
                    Not yet
                  </Button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const PLACEHOLDER_LABELS: Readonly<Record<string, string>> = {
  serviceDate: "Which service (for example “Sunday 12 October”)",
  serviceName: "Which service or event",
  groupName: "Which group",
  firstName: "Their name",
  preferredName: "Their name",
};

/** Puts typed words in place of each `{{placeholder}}` that has some. */
function fillIn(body: string, fills: Readonly<Record<string, string>>): string {
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (token, key: string) => fills[key]?.trim() || token);
}

/** People this team member recorded as emailed with this wording lately. */
function recentlySent(
  communications: readonly CommunicationLogEntry[],
  templateId: string,
  teamMemberId: string | null,
  now: Date,
): ReadonlySet<PersonId> {
  const since = new Date(now.getTime() - RECENT_MS).toISOString();
  return new Set(
    communications
      .filter(
        (entry) =>
          entry.status === "sent_external" &&
          entry.templateId === templateId &&
          entry.actorId === teamMemberId &&
          entry.at >= since,
      )
      .map((entry) => entry.personId),
  );
}
