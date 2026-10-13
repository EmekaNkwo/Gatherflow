"use client";

import { useMemo, useState } from "react";
import { AlertTriangleIcon, CopyIcon, ExternalLinkIcon, SendIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { SimulatedBadge } from "@/components/shared/badges";
import { displayName } from "@/lib/strings";
import { CONTACT_METHODS, CONTACT_METHOD_LABELS, type ContactMethod } from "@/types/common";
import type { TaskId } from "@/types/common";
import type { MessageTemplate } from "@/types/communication";
import type { Person } from "@/types/person";
import { useCommunications } from "@/hooks/useCommunications";

interface MessageComposerProps {
  person: Person | null;
  taskId?: TaskId;
  onOpenChange: (open: boolean) => void;
}

/**
 * Prepares a message and records what actually happened to it.
 *
 * Nothing is sent from here. The user copies the text, hands it to an app
 * they already have, or records a simulated send for the demo — and the log
 * says which of those it was.
 */
export function MessageComposer({ person, taskId, onOpenChange }: MessageComposerProps) {
  const { templates } = useCommunications();

  const blocked = person?.contact.optedOut
    ? `${displayName(person)} has asked not to be contacted. No message can be prepared.`
    : person && !person.contact.permissionGranted
      ? `${displayName(person)} has not given permission to be contacted.`
      : null;

  return (
    <Dialog open={Boolean(person)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Prepare a message
            <SimulatedBadge />
          </DialogTitle>
          <DialogDescription>
            {person
              ? `For ${displayName(person)}. Nothing is sent by GatherFlow — you copy it, open your own app, or record a simulated send.`
              : null}
          </DialogDescription>
        </DialogHeader>

        {blocked ? (
          <>
            <Alert variant="destructive">
              <AlertTriangleIcon />
              <AlertTitle>Contact not permitted</AlertTitle>
              <AlertDescription>{blocked}</AlertDescription>
            </Alert>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            </DialogFooter>
          </>
        ) : person ? (
          <ComposerBody
            key={person.id}
            person={person}
            templates={templates}
            taskId={taskId}
            onClose={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ComposerBody({
  person,
  templates,
  taskId,
  onClose,
}: {
  person: Person;
  templates: readonly MessageTemplate[];
  taskId?: TaskId;
  onClose: () => void;
}) {
  const { prepare, copyAndLog, openExternally, simulateSend, log } = useCommunications();

  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [channel, setChannel] = useState<ContactMethod>(person.contact.preferredMethod);
  /** `null` means "use the rendered template"; anything else is a user edit. */
  const [edited, setEdited] = useState<string | null>(null);

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

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="composer-template">Template</FieldLabel>
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
          <FieldLabel htmlFor="composer-channel">Channel</FieldLabel>
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
        <Alert variant="destructive">
          <AlertTriangleIcon />
          <AlertTitle>Message could not be prepared</AlertTitle>
          <AlertDescription>{problem}</AlertDescription>
        </Alert>
      ) : null}

      {draft?.limitWarning ? (
        <Alert>
          <AlertTriangleIcon />
          <AlertTitle>Contact limit reached</AlertTitle>
          <AlertDescription>{draft.limitWarning}</AlertDescription>
        </Alert>
      ) : null}

      {draft?.missing.length ? (
        <Alert variant="destructive">
          <AlertTriangleIcon />
          <AlertTitle>Unfilled placeholders</AlertTitle>
          <AlertDescription>
            {draft.missing.map((entry) => `{{${entry}}}`).join(", ")} could not be filled in. Edit
            the message before using it.
          </AlertDescription>
        </Alert>
      ) : null}

      <Field>
        <FieldLabel htmlFor="composer-body">Message</FieldLabel>
        <Textarea
          id="composer-body"
          rows={8}
          value={body}
          onChange={(event) => setEdited(event.target.value)}
        />
        <FieldDescription>
          Exactly what the person will see. You can edit it before using it.
        </FieldDescription>
      </Field>

      <DialogFooter className="flex-col gap-2 sm:flex-row">
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
        {payload ? (
          <>
            <Button
              variant="outline"
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
              Save as draft
            </Button>
            <Button
              variant="outline"
              className="gap-1.5"
              onClick={() => void copyAndLog(payload, taskId)}
            >
              <CopyIcon />
              Copy
            </Button>
            <Button
              variant="outline"
              className="gap-1.5"
              disabled={!payload.externalLink}
              onClick={() => openExternally(payload, taskId)}
            >
              <ExternalLinkIcon />
              Open in app
            </Button>
            <Button
              className="gap-1.5"
              onClick={() => {
                simulateSend(payload, taskId);
                onClose();
              }}
            >
              <SendIcon />
              Record simulated send
            </Button>
          </>
        ) : null}
      </DialogFooter>
    </>
  );
}
