"use client";

import { useMemo, useState, type ReactNode } from "react";
import { AlertTriangleIcon, CopyIcon, ExternalLinkIcon, MailIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { DialogActions, DialogBody, ResponsiveDialog } from "@/components/people/responsive-dialog";
import { displayName } from "@/lib/strings";
import { CONTACT_METHODS, CONTACT_METHOD_LABELS, type ContactMethod } from "@/types/common";
import type { TaskId } from "@/types/common";
import type { MessageTemplate } from "@/types/communication";
import type { EmailAvailability } from "@/types/email";
import type { Person } from "@/types/person";
import { useCommunications } from "@/hooks/useCommunications";

interface MessageComposerProps {
  person: Person | null;
  taskId?: TaskId;
  onOpenChange: (open: boolean) => void;
}

/**
 * Writes a message and records what actually happened to it.
 *
 * WhatsApp, text and phone are handed to an app the person already has: the
 * text is copied or opened there, and the log says which. Email is sent for
 * real when the deployment has switched sending on; then Send is the main
 * button, and the record's status afterwards is whatever the provider
 * reports.
 */
export function MessageComposer({ person, taskId, onOpenChange }: MessageComposerProps) {
  const { templates, email } = useCommunications();
  const name = person ? displayName(person) : "";
  const firstName = name.split(" ")[0];

  const blocked = person?.contact.optedOut
    ? `${name} asked not to be contacted, so no message can be written to them.`
    : person && !person.contact.permissionGranted
      ? `${name} hasn't said they're happy to be contacted yet.`
      : null;

  return (
    <ResponsiveDialog
      open={Boolean(person)}
      onOpenChange={onOpenChange}
      title={person ? `Write to ${firstName}` : "Write a message"}
      description={
        person && !blocked
          ? email.enabled
            ? "Email is sent by the church. Anything else opens in your own app."
            : "It opens in your own app, or you can copy it. Nothing is sent from here."
          : null
      }
      className="sm:max-w-xl"
    >
      {blocked ? (
        <>
          <DialogBody>
            <Notice tone="destructive" title="We can't message them">
              {blocked}
            </Notice>
          </DialogBody>
          <DialogActions>
            <Button variant="outline" size="lg" className="flex-1" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </DialogActions>
        </>
      ) : person ? (
        <ComposerBody
          key={person.id}
          person={person}
          templates={templates}
          taskId={taskId}
          email={email}
          onClose={() => onOpenChange(false)}
        />
      ) : null}
    </ResponsiveDialog>
  );
}

function Notice({
  tone = "neutral",
  title,
  children,
}: {
  tone?: "neutral" | "destructive";
  title: string;
  children: ReactNode;
}) {
  return (
    <div
      role={tone === "destructive" ? "alert" : "status"}
      className={
        tone === "destructive"
          ? "flex gap-3 rounded-2xl bg-destructive/10 px-4 py-3 text-sm"
          : "flex gap-3 rounded-2xl bg-muted px-4 py-3 text-sm"
      }
    >
      <AlertTriangleIcon
        className={tone === "destructive" ? "mt-0.5 size-4 shrink-0 text-destructive" : "mt-0.5 size-4 shrink-0 text-primary"}
      />
      <div>
        <p className="font-medium">{title}</p>
        <p className="text-muted-foreground">{children}</p>
      </div>
    </div>
  );
}

function ComposerBody({
  person,
  templates,
  taskId,
  email,
  onClose,
}: {
  person: Person;
  templates: readonly MessageTemplate[];
  taskId?: TaskId;
  email: EmailAvailability;
  onClose: () => void;
}) {
  const { prepare, copyAndLog, openExternally, sendEmail, log } = useCommunications();

  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [channel, setChannel] = useState<ContactMethod>(person.contact.preferredMethod);
  /** `null` means "use the rendered template"; anything else is a user edit. */
  const [edited, setEdited] = useState<string | null>(null);
  const [subject, setSubject] = useState("");
  const [sending, setSending] = useState(false);

  // The draft is derived, so changing template or channel re-renders the
  // message without an effect writing state during render.
  const prepared = useMemo(
    () => (templateId ? prepare({ personId: person.id, templateId, channel, taskId }) : null),
    [prepare, person.id, templateId, channel, taskId],
  );
  const draft = prepared && prepared.ok ? prepared.value : null;
  const problem = prepared && !prepared.ok ? prepared.error : null;

  const body = edited ?? draft?.body ?? "";
  const channelOptions = templates.find((entry) => entry.id === templateId)?.channels ?? CONTACT_METHODS;

  const payload = draft ? { ...draft, body } : null;

  // Real sending is offered only for email, only when the deployment has
  // switched it on, and only to somebody with an address.
  const canSendEmail = email.enabled && channel === "email" && Boolean(person.email);
  const unfilled = Boolean(draft?.missing.length) && edited === null;
  // The one filled button: send when we can, else open their app, else copy.
  const primary: "send" | "open" | "copy" = canSendEmail ? "send" : payload?.externalLink ? "open" : "copy";

  async function onSendEmail() {
    if (!payload) return;
    setSending(true);
    const outcome = await sendEmail({
      personId: person.id,
      templateId: payload.templateId,
      taskId,
      subject,
      body,
    });
    setSending(false);
    if (outcome.ok) onClose();
  }

  return (
    <>
      <DialogBody>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="composer-template">What to say</FieldLabel>
            <NativeSelect
              className="w-full"
              id="composer-template"
              value={templateId}
              onChange={(event) => {
                setTemplateId(event.target.value);
                setEdited(null);
              }}
            >
              {templates.map((template) => (
                <NativeSelectOption key={template.id} value={template.id}>
                  {template.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor="composer-channel">How to send it</FieldLabel>
            <NativeSelect
              className="w-full"
              id="composer-channel"
              value={channel}
              onChange={(event) => setChannel(event.target.value as ContactMethod)}
            >
              {channelOptions.map((option) => (
                <NativeSelectOption key={option} value={option}>
                  {CONTACT_METHOD_LABELS[option]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <FieldDescription>
              They prefer {CONTACT_METHOD_LABELS[person.contact.preferredMethod].toLowerCase()}.
            </FieldDescription>
          </Field>
        </div>

        {problem ? (
          <Notice tone="destructive" title="This message couldn't be written">
            {problem}
          </Notice>
        ) : null}

        {draft?.limitWarning ? <Notice title="They've been contacted a lot lately">{draft.limitWarning}</Notice> : null}

        {draft?.missing.length ? (
          <Notice tone="destructive" title="Some gaps need filling in">
            {draft.missing.map((entry) => `{{${entry}}}`).join(", ")} couldn&apos;t be filled in. Edit the message
            before using it.
          </Notice>
        ) : null}

        {canSendEmail ? (
          <Field>
            <FieldLabel htmlFor="composer-subject">Subject</FieldLabel>
            <Input
              id="composer-subject"
              className="h-11"
              value={subject}
              maxLength={200}
              placeholder="Leave blank to use the church's name"
              onChange={(event) => setSubject(event.target.value)}
            />
            <FieldDescription>
              To {person.email}
              {email.pilot ? ". The church is trying email out, so only some addresses can receive it." : "."}
            </FieldDescription>
          </Field>
        ) : null}

        <Field>
          <FieldLabel htmlFor="composer-body">Message</FieldLabel>
          <Textarea
            id="composer-body"
            rows={8}
            className="text-base"
            value={body}
            onChange={(event) => setEdited(event.target.value)}
          />
          <FieldDescription>Exactly what they&apos;ll see. Change anything you like.</FieldDescription>
        </Field>

        {payload ? (
          <button
            type="button"
            className="min-h-11 text-sm font-medium text-primary underline-offset-4 hover:underline"
            onClick={() =>
              log({
                personId: person.id,
                channel: payload.channel,
                status: "drafted",
                body,
                templateId: payload.templateId,
                taskId,
              })
            }
          >
            Save as draft for later
          </button>
        ) : null}
      </DialogBody>

      <DialogActions>
        {payload ? (
          <>
            <Button
              size="lg"
              variant={primary === "copy" ? "default" : "outline"}
              className={primary === "copy" ? "flex-1" : undefined}
              onClick={() => void copyAndLog(payload, taskId)}
            >
              <CopyIcon />
              Copy
            </Button>
            {payload.externalLink ? (
              <Button
                size="lg"
                variant={primary === "open" ? "default" : "outline"}
                className={primary === "open" ? "flex-1" : undefined}
                onClick={() => openExternally(payload, taskId)}
              >
                <ExternalLinkIcon />
                Open in app
              </Button>
            ) : null}
            {canSendEmail ? (
              <Button
                size="lg"
                className="flex-1"
                disabled={sending || unfilled || !body.trim()}
                onClick={() => void onSendEmail()}
              >
                <MailIcon />
                {sending ? "Sending…" : "Send email"}
              </Button>
            ) : null}
          </>
        ) : (
          <Button variant="outline" size="lg" className="flex-1" onClick={onClose}>
            Close
          </Button>
        )}
      </DialogActions>
    </>
  );
}
