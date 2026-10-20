"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { CheckIcon, CopyIcon, ExternalLinkIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { pluralise } from "@/lib/strings";
import type { MessageTemplate } from "@/types/communication";
import { useCommunications } from "@/hooks/useCommunications";
import { useSnapshot } from "@/hooks/use-church-data";
import { useSessionStore } from "@/stores/session-store";
import {
  bccBatches,
  buildMailto,
  renderForEveryone,
  type EmailRecipient,
} from "@/services/communications/group-email";
import { gapsIn } from "@/services/communications/template-engine";
import { Notice } from "./notice";

interface EmailEveryoneProps {
  recipients: readonly EmailRecipient[];
  template: MessageTemplate;
  subject: string;
  groupName?: string;
  onRecorded: () => void;
}

/** Matches the server's limit on a logged message. */
const MESSAGE_MAX_LENGTH = 5_000;

/**
 * One email for the whole list, every address in BCC so nobody sees anyone
 * else's. A list too long for one link is split into several emails; a
 * message too long for any link is copied instead.
 */
export function EmailEveryone({ recipients, template, subject, groupName, onRecorded }: EmailEveryoneProps) {
  const snapshot = useSnapshot();
  const { recordSentEmails } = useCommunications();
  const teamMemberId = useSessionStore((state) => state.teamMemberId);
  const senderName = snapshot.team.find((member) => member.id === teamMemberId)?.name ?? "the church team";

  const rendered = useMemo(
    () =>
      renderForEveryone(
        snapshot,
        template.body,
        recipients.map((recipient) => recipient.person),
        { senderName, groupName },
      ),
    [snapshot, template.body, recipients, senderName, groupName],
  );

  /** `null` means "use the rendered template"; anything else is an edit. */
  const [edited, setEdited] = useState<string | null>(null);
  /** Batches handed to the email app, by position. */
  const [opened, setOpened] = useState<ReadonlySet<number>>(new Set());
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const body = edited ?? rendered.text;
  const gaps = gapsIn(body);
  const emails = recipients.map((recipient) => recipient.email);
  const batches = bccBatches(emails, subject, body);
  const handedOver = opened.size > 0 || copied;

  function open(index: number, batch: readonly string[]) {
    setOpened((previous) => new Set([...previous, index]));
    window.location.assign(buildMailto({ bcc: batch, subject, body }));
  }

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success(`${what} copied`);
    } catch {
      toast.error("Could not reach the clipboard. Select the text and copy it yourself.");
    }
  }

  async function confirmSent() {
    if (busy) return;
    // Only the people whose email was actually opened, unless it was copied.
    const sentTo = copied || !batches ? emails : [...opened].flatMap((index) => batches[index] ?? []);
    const entries = recipients
      .filter((recipient) => sentTo.includes(recipient.email))
      .map((recipient) => ({ personId: recipient.person.id, body }));
    setBusy(true);
    const outcome = await recordSentEmails(entries, template.id);
    setBusy(false);
    if (outcome.ok) onRecorded();
  }

  return (
    <div className="space-y-4">
      <Field>
        <FieldLabel htmlFor="group-email-body">Message</FieldLabel>
        <Textarea
          id="group-email-body"
          rows={8}
          className="text-base"
          value={body}
          maxLength={MESSAGE_MAX_LENGTH}
          onChange={(event) => setEdited(event.target.value)}
        />
        <FieldDescription>Everyone gets exactly this. Change anything you like.</FieldDescription>
      </Field>

      {gaps.length ? (
        <Notice tone="destructive" title="Some gaps need filling in">
          {gaps.join(", ")} still {gaps.length === 1 ? "needs" : "need"} replacing with real words before this can be
          sent.
        </Notice>
      ) : null}

      {batches ? (
        <div className="space-y-2">
          {batches.length > 1 ? (
            <p className="text-sm text-muted-foreground">
              That&apos;s too many addresses for one email app link, so it&apos;s split into {batches.length} emails.
              Open and send each one.
            </p>
          ) : null}
          {batches.map((batch, index) => (
            <Button
              key={batch[0]}
              size="lg"
              variant={opened.has(index) ? "outline" : "default"}
              className="w-full justify-start gap-2"
              disabled={gaps.length > 0 || !body.trim()}
              onClick={() => open(index, batch)}
            >
              {opened.has(index) ? <CheckIcon /> : <ExternalLinkIcon />}
              {batches.length > 1
                ? `Open email ${index + 1} of ${batches.length} · ${batch.length} ${pluralise(batch.length, "person", "people")}`
                : "Open in your email app"}
            </Button>
          ))}
        </div>
      ) : (
        <Notice title="Too long to open directly">
          Email apps can&apos;t take a message this long from a link. Copy the addresses and the message into a new
          email instead.
        </Notice>
      )}

      <div className="flex flex-wrap gap-x-4">
        <button
          type="button"
          className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline"
          onClick={() => void copy(emails.join(", "), "Addresses")}
        >
          <CopyIcon className="size-4" />
          Copy addresses (paste into BCC)
        </button>
        <button
          type="button"
          disabled={gaps.length > 0}
          className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline disabled:opacity-50"
          onClick={() => void copy(body, "Message")}
        >
          <CopyIcon className="size-4" />
          Copy message
        </button>
      </div>

      {handedOver ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-muted px-4 py-3">
          <p className="text-sm">Once it&apos;s gone, let us know so it&apos;s on their record.</p>
          <Button className="min-h-11" disabled={busy} onClick={() => void confirmSent()}>
            {busy ? "Saving…" : "I sent it"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
