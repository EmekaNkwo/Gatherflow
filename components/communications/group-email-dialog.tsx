"use client";

import { useMemo, useState } from "react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { DialogActions, DialogBody, ResponsiveDialog } from "@/components/people/responsive-dialog";
import { SelectField } from "@/components/shared/select-field";
import { displayName, pluralise } from "@/lib/strings";
import type { PersonId } from "@/types/common";
import { useCommunications } from "@/hooks/useCommunications";
import { useRole } from "@/hooks/useRole";
import { useSnapshot } from "@/hooks/use-church-data";
import {
  hasPersonalPlaceholders,
  SKIP_REASON_LABELS,
  sortRecipients,
  type EmailRecipient,
} from "@/services/communications/group-email";
import { chooseTemplate } from "@/services/communications/template-choice";
import { EmailEveryone } from "./email-everyone";
import { EmailQueue } from "./email-queue";
import { Notice } from "./notice";

export interface GroupEmailDialogProps {
  /** Who to write to; `null` keeps the dialog closed. */
  personIds: readonly PersonId[] | null;
  /** Fills `{{groupName}}` when writing to a group. */
  groupName?: string;
  onOpenChange: (open: boolean) => void;
}

type Mode = "each" | "everyone";

/**
 * Emails several people through the sender's own email app.
 *
 * Two ways, because one email can only say one name: a personal email to
 * each person (opened one at a time, every placeholder filled), or one email
 * to everyone with the addresses hidden in BCC and the greeting made general.
 * Nothing is sent from here, and it is recorded only once they say they sent it.
 */
export function GroupEmailDialog({ personIds, groupName, onOpenChange }: GroupEmailDialogProps) {
  const count = personIds?.length ?? 0;
  return (
    <ResponsiveDialog
      open={personIds !== null}
      onOpenChange={onOpenChange}
      title={`Email ${count} ${pluralise(count, "person", "people")}`}
      description="It opens in your own email app, ready to send. Nothing is sent from GatherFlow."
      className="sm:max-w-xl"
    >
      {personIds ? (
        <GroupEmailBody
          key={personIds.join(",")}
          personIds={personIds}
          groupName={groupName}
          onClose={() => onOpenChange(false)}
        />
      ) : null}
    </ResponsiveDialog>
  );
}

function GroupEmailBody({
  personIds,
  groupName,
  onClose,
}: {
  personIds: readonly PersonId[];
  groupName?: string;
  onClose: () => void;
}) {
  const snapshot = useSnapshot();
  const { templates } = useCommunications();
  const { canRun } = useRole();

  const { ready, skipped, notYours } = useMemo(() => {
    const sorted = sortRecipients(snapshot, personIds);
    // A volunteer records messages only for the people they look after.
    const mine = (recipient: EmailRecipient) =>
      canRun("communication.logMany", {
        channel: "email",
        status: "sent_external",
        entries: [{ personId: recipient.person.id, body: "" }],
      });
    return {
      ready: sorted.ready.filter(mine),
      skipped: sorted.skipped,
      notYours: sorted.ready.filter((recipient) => !mine(recipient)),
    };
  }, [snapshot, personIds, canRun]);

  // Every wording is offered: a template's channels only rank suggestions,
  // and the chooser below already prefers those marked for email.
  const emailTemplates = templates;

  const [templateId, setTemplateId] = useState(
    () =>
      chooseTemplate(emailTemplates, {
        preferredMethod: "email",
        // A group is written to as a group, whatever its people's history.
        isVisitor: !groupName && ready.length > 0 && ready.every((recipient) => recipient.person.kind === "visitor"),
      })?.id ?? emailTemplates[0]?.id ?? "",
  );
  const template = emailTemplates.find((entry) => entry.id === templateId);
  const [subject, setSubject] = useState(snapshot.settings.churchName);

  const personal = template ? hasPersonalPlaceholders(template.body) : false;
  const [chosenMode, setMode] = useState<Mode | null>(null);
  // One person always gets their own email; otherwise names decide the default.
  const mode: Mode = ready.length <= 1 ? "each" : (chosenMode ?? (personal ? "each" : "everyone"));

  const leftOut = [
    ...skipped.map((entry) => `${entry.name} (${SKIP_REASON_LABELS[entry.reason]})`),
    ...notYours.map(({ person }) => `${displayName(person)} (not someone you look after)`),
  ];

  return (
    <>
      <DialogBody>
        {!ready.length ? (
          <Notice tone="destructive" title="Nobody here can be emailed">
            {leftOut.join(", ")}.
          </Notice>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                id="group-email-template"
                label="What to say"
                value={templateId}
                onValueChange={setTemplateId}
                options={emailTemplates.map((entry) => ({ value: entry.id, label: entry.name }))}
              />
              <Field>
                <FieldLabel htmlFor="group-email-subject">Subject</FieldLabel>
                <Input
                  id="group-email-subject"
                  className="h-11"
                  value={subject}
                  maxLength={200}
                  onChange={(event) => setSubject(event.target.value)}
                />
              </Field>
            </div>

            {ready.length > 1 ? (
              <ModeChoice mode={mode} personal={personal} count={ready.length} onChange={setMode} />
            ) : null}

            {leftOut.length ? (
              <Notice title={`${leftOut.length} left out`}>{leftOut.join(", ")}.</Notice>
            ) : null}

            {template ? (
              mode === "each" ? (
                <EmailQueue
                  key={template.id}
                  recipients={ready}
                  template={template}
                  subject={subject}
                  groupName={groupName}
                />
              ) : (
                <EmailEveryone
                  key={template.id}
                  recipients={ready}
                  template={template}
                  subject={subject}
                  groupName={groupName}
                  onRecorded={onClose}
                />
              )
            ) : null}
          </>
        )}
      </DialogBody>
      <DialogActions>
        <Button variant="outline" size="lg" className="flex-1" onClick={onClose}>
          Done
        </Button>
      </DialogActions>
    </>
  );
}

function ModeChoice({
  mode,
  personal,
  count,
  onChange,
}: {
  mode: Mode;
  personal: boolean;
  count: number;
  onChange: (mode: Mode) => void;
}) {
  const options: { value: Mode; title: string; detail: string }[] = [
    {
      value: "each",
      title: "A personal email to each",
      detail: `${count} emails, each with their own name. You open them one at a time.`,
    },
    {
      value: "everyone",
      title: "One email to everyone",
      detail: personal
        ? "Addresses hidden in BCC. Names can't be filled, so it says “everyone”."
        : "Addresses hidden in BCC, so nobody sees the others.",
    },
  ];

  return (
    <Field>
      <FieldLabel>How to send it</FieldLabel>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={mode === option.value}
            onClick={() => onChange(option.value)}
            className={cn(
              "min-h-11 rounded-2xl border px-4 py-3 text-left transition-colors",
              mode === option.value ? "border-primary bg-primary/8" : "hover:bg-muted/60",
            )}
          >
            <span className="block font-medium">{option.title}</span>
            <span className="block text-sm text-muted-foreground">{option.detail}</span>
          </button>
        ))}
      </div>
      {personal && mode === "everyone" ? (
        <FieldDescription>Check the wording below reads well without a name.</FieldDescription>
      ) : null}
    </Field>
  );
}
