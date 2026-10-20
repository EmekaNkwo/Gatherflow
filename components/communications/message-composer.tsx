"use client";

import { useState, type ReactNode } from "react";
import { AlertTriangleIcon, CopyIcon, ExternalLinkIcon, MailIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DialogActions, DialogBody, ResponsiveDialog } from "@/components/people/responsive-dialog";
import { SelectField } from "@/components/shared/select-field";
import { displayName } from "@/lib/strings";
import { CONTACT_METHODS, CONTACT_METHOD_LABELS, type ContactMethod } from "@/types/common";
import type { TaskId } from "@/types/common";
import type { CommunicationLogEntry, MessageTemplate } from "@/types/communication";
import type { EmailAvailability } from "@/types/email";
import type { Person } from "@/types/person";
import { useCommunications } from "@/hooks/useCommunications";
import { useSnapshot } from "@/hooks/use-church-data";
import { formatDisplayDate } from "@/lib/dates";
import { channelFor, chooseTemplate } from "@/services/communications/template-choice";
import { gapsIn } from "@/services/communications/template-engine";
import { useSessionStore } from "@/stores/session-store";

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
  const { prepare, copyAndLog, openExternally, sendEmail, log, linkFor } = useCommunications();
  const snapshot = useSnapshot();
  const teamMemberId = useSessionStore((state) => state.teamMemberId);
  const preferred = person.contact.preferredMethod;

  const savedDraft = latestOwnDraft(snapshot.communications, person.id, teamMemberId);

  // Chosen once, when the composer opens: the wording that suits the task or
  // the person, rather than whatever sorts first.
  const [templateId, setTemplateId] = useState(
    () =>
      chooseTemplate(templates, {
        preferredMethod: preferred,
        taskType: taskId ? snapshot.tasks.find((task) => task.id === taskId)?.type : undefined,
        isVisitor: Boolean(person.visitor),
      })?.id ?? "",
  );
  const template = templates.find((entry) => entry.id === templateId);
  const [chosenChannel, setChannel] = useState<ContactMethod>(() => channelFor(template, preferred));
  // Never a channel the template doesn't offer.
  const channel = channelFor(template, preferred, chosenChannel);
  /** `null` means "use the rendered template"; anything else is a user edit. */
  const [edited, setEdited] = useState<string | null>(null);
  const [subject, setSubject] = useState("");
  const [busy, setBusy] = useState(false);

  // The draft is derived, so changing template or channel re-renders the
  // message without an effect writing state during render.
  const prepared = templateId ? prepare({ personId: person.id, templateId, channel, taskId }) : null;
  const draft = prepared && prepared.ok ? prepared.value : null;
  const problem = prepared && !prepared.ok ? prepared.error : null;

  const body = edited ?? draft?.body ?? "";
  const channelOptions = template?.channels ?? CONTACT_METHODS;
  // Built from the words as they are now, so edits are what the app receives.
  const link = draft ? linkFor(draft, body) : undefined;
  const gaps = gapsIn(body);
  // Nothing leaves while a gap remains or while a request is on its way.
  const blockedSend = busy || gaps.length > 0 || !body.trim();

  // Real sending is offered only for email, only when the deployment has
  // switched it on, and only to somebody with an address.
  const canSendEmail = email.enabled && channel === "email" && Boolean(person.email);
  // The one filled button: send when we can, else open their app, else copy.
  const primary: "send" | "open" | "copy" = canSendEmail ? "send" : link ? "open" : "copy";

  async function run(action: () => Promise<boolean>) {
    if (busy) return;
    setBusy(true);
    const done = await action();
    setBusy(false);
    if (done) onClose();
  }

  async function onSendEmail() {
    if (!draft) return false;
    const outcome = await sendEmail({ personId: person.id, templateId: draft.templateId, taskId, subject, body });
    return outcome.ok;
  }

  async function onSaveDraft() {
    if (!draft) return false;
    const outcome = await log({
      personId: person.id,
      channel: draft.channel,
      status: "drafted",
      body,
      templateId: draft.templateId,
      taskId,
    });
    return outcome.ok;
  }

  function resumeDraft() {
    if (!savedDraft) return;
    if (savedDraft.templateId && templates.some((entry) => entry.id === savedDraft.templateId)) {
      setTemplateId(savedDraft.templateId);
    }
    setChannel(savedDraft.channel);
    setEdited(savedDraft.body);
  }

  return (
    <>
      <DialogBody>
        {savedDraft && edited === null ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-muted px-4 py-3 text-sm">
            <p>You saved a draft for {person.firstName} on {formatDisplayDate(savedDraft.at)}.</p>
            <Button variant="outline" className="min-h-11" onClick={resumeDraft}>
              Pick up your draft
            </Button>
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            id="composer-template"
            label="What to say"
            value={templateId}
            onValueChange={(value) => {
              setTemplateId(value);
              setEdited(null);
            }}
            options={templates.map((entry) => ({ value: entry.id, label: entry.name }))}
          />
          <SelectField
            id="composer-channel"
            label="How to send it"
            value={channel}
            onValueChange={(value) => setChannel(value as ContactMethod)}
            options={channelOptions.map((option) => ({ value: option, label: CONTACT_METHOD_LABELS[option] }))}
            description={
              channelOptions.includes(preferred)
                ? `They prefer ${CONTACT_METHOD_LABELS[preferred].toLowerCase()}.`
                : `They prefer ${CONTACT_METHOD_LABELS[preferred].toLowerCase()}, which this wording isn't set up for.`
            }
          />
        </div>

        {problem ? (
          <Notice tone="destructive" title="This message couldn't be written">
            {problem}
          </Notice>
        ) : null}

        {draft?.limitWarning ? <Notice title="They've been contacted a lot lately">{draft.limitWarning}</Notice> : null}

        {draft && gaps.length ? (
          <Notice tone="destructive" title="Some gaps need filling in">
            {gaps.join(", ")} still {gaps.length === 1 ? "needs" : "need"} replacing with real words before this
            can be sent.
          </Notice>
        ) : null}

        {draft && channel === "whatsapp" && !link ? (
          <Notice title="No WhatsApp number we can use">
            {person.phone
              ? `We can't read ${person.phone} as a full phone number, so WhatsApp can't be opened. Copy the message instead.`
              : `There's no phone number for ${person.firstName}. Copy the message instead.`}
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
            maxLength={MESSAGE_MAX_LENGTH}
            onChange={(event) => setEdited(event.target.value)}
          />
          <FieldDescription>
            Exactly what they&apos;ll see. Change anything you like. {body.length} of {MESSAGE_MAX_LENGTH} characters.
          </FieldDescription>
        </Field>

        {draft ? (
          <button
            type="button"
            disabled={busy || !body.trim()}
            className="min-h-11 text-sm font-medium text-primary underline-offset-4 hover:underline disabled:opacity-50"
            onClick={() => void run(onSaveDraft)}
          >
            Save as a draft for later
          </button>
        ) : null}
      </DialogBody>

      <DialogActions>
        {draft ? (
          <>
            <Button
              size="lg"
              variant={primary === "copy" ? "default" : "outline"}
              className={primary === "copy" ? "flex-1" : undefined}
              disabled={blockedSend}
              onClick={() => void run(() => copyAndLog(draft, body, taskId))}
            >
              <CopyIcon />
              Copy
            </Button>
            {link ? (
              <Button
                size="lg"
                variant={primary === "open" ? "default" : "outline"}
                className={primary === "open" ? "flex-1" : undefined}
                disabled={blockedSend}
                onClick={() => void run(() => openExternally(draft, body, taskId))}
              >
                <ExternalLinkIcon />
                Open in app
              </Button>
            ) : null}
            {canSendEmail ? (
              <Button size="lg" className="flex-1" disabled={blockedSend} onClick={() => void run(onSendEmail)}>
                <MailIcon />
                {busy ? "Sending…" : "Send email"}
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

/** Matches the server's limit on a logged message. */
const MESSAGE_MAX_LENGTH = 5_000;

/**
 * The draft this team member saved for this person, if nothing has been
 * recorded for the person since — once someone has reached them the draft is
 * no longer the latest word.
 */
function latestOwnDraft(
  communications: readonly CommunicationLogEntry[],
  personId: string,
  teamMemberId: string | null,
): CommunicationLogEntry | undefined {
  const latest = communications
    .filter((entry) => entry.personId === personId)
    .reduce<CommunicationLogEntry | undefined>((found, entry) => (!found || entry.at > found.at ? entry : found), undefined);
  return latest && latest.status === "drafted" && latest.actorId === teamMemberId ? latest : undefined;
}
