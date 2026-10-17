"use client";

import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import type { ContactMethod, PersonId, TaskId, TemplateId } from "@/types/common";
import type { ManualCommunicationStatus } from "@/types/communication";
import type { Result } from "@/lib/result";
import {
  communicationsForPerson,
  draftMessage,
  type DraftMessageInput,
  type MessageDraft,
} from "@/services/communications/messaging";
import { type TemplateInput } from "@/services/communications/templates";
import { createCommandContext } from "@/services/core/context";
import { useChurchStore } from "@/stores/church-store";
import { useSessionStore } from "@/stores/session-store";
import type { SendEmailRequest } from "@/types/email";
import { useCommand, useSnapshot } from "./use-church-data";
import { useNow } from "./use-now";

/**
 * Message drafting, real email, and the communication log.
 *
 * Drafts are copied or handed to an app the user already has, and the log
 * records exactly which of those happened. Real email exists only in the
 * server-backed mode, and only when the deployment has switched it on; the
 * log then records what the provider actually reported, never more.
 */
export function useCommunications() {
  const snapshot = useSnapshot();
  const now = useNow();
  const { dispatch } = useCommand();
  const teamMemberId = useSessionStore((state) => state.teamMemberId);
  const email = useChurchStore((state) => state.email);
  const sendEmailCommand = useChurchStore((state) => state.sendEmail);

  const templates = useMemo(
    () => [...snapshot.templates].sort((left, right) => left.name.localeCompare(right.name)),
    [snapshot.templates],
  );

  const history = useMemo(() => {
    const peopleById = new Map(snapshot.people.map((person) => [person.id, person]));
    const teamById = new Map(snapshot.team.map((member) => [member.id, member]));
    return [...snapshot.communications]
      .sort((left, right) => (left.at < right.at ? 1 : -1))
      .map((entry) => ({
        entry,
        person: peopleById.get(entry.personId),
        actor: teamById.get(entry.actorId),
        template: snapshot.templates.find((template) => template.id === entry.templateId),
      }));
  }, [snapshot]);

  /**
   * Prepares a draft without changing any state, and without side effects:
   * callers render the refusal, so this is safe to use while rendering.
   */
  const prepare = useCallback(
    (input: DraftMessageInput): Result<MessageDraft> =>
      draftMessage(snapshot, input, createCommandContext({ actorId: teamMemberId ?? "", now })),
    [snapshot, teamMemberId, now],
  );

  const log = useCallback(
    (input: {
      personId: PersonId;
      channel: ContactMethod;
      status: ManualCommunicationStatus;
      body: string;
      templateId?: TemplateId;
      taskId?: TaskId;
    }) => dispatch("communication.log", input),
    [dispatch],
  );

  /** Copies the message and records that it was copied. */
  const copyAndLog = useCallback(
    async (draft: MessageDraft, taskId?: TaskId) => {
      try {
        await navigator.clipboard.writeText(draft.body);
      } catch {
        toast.error("Could not reach the clipboard. Select the text and copy it manually.");
        return;
      }
      await log({
        personId: draft.personId,
        channel: draft.channel,
        status: "copied",
        body: draft.body,
        templateId: draft.templateId,
        taskId,
      });
    },
    [log],
  );

  /** Opens the user's own messaging app, then records that it was opened. */
  const openExternally = useCallback(
    (draft: MessageDraft, taskId?: TaskId) => {
      if (!draft.externalLink) {
        toast.error("There is no contact detail for that channel.");
        return;
      }
      window.open(draft.externalLink, "_blank", "noopener,noreferrer");
      void log({
        personId: draft.personId,
        channel: draft.channel,
        status: "opened_external",
        body: draft.body,
        templateId: draft.templateId,
        taskId,
      });
    },
    [log],
  );

  /**
   * Queues a real email through the server. The toast says "queued", not
   * "sent": the worker sends it afterwards and the record's status follows
   * what the provider reports.
   */
  const sendEmail = useCallback(
    async (input: SendEmailRequest) => {
      const outcome = await sendEmailCommand(input);
      if (!outcome.ok) {
        toast.error(outcome.error);
        return outcome;
      }
      toast.success("Email queued", {
        description: `It will be sent to ${outcome.value.toEmail} within a few minutes.`,
      });
      return outcome;
    },
    [sendEmailCommand],
  );

  const addTemplate = useCallback(
    (input: TemplateInput) => dispatch("template.create", input),
    [dispatch],
  );

  const editTemplate = useCallback(
    (templateId: TemplateId, input: TemplateInput) =>
      dispatch("template.update", { templateId, input }),
    [dispatch],
  );

  const removeTemplate = useCallback(
    (templateId: TemplateId) => dispatch("template.delete", { templateId }),
    [dispatch],
  );

  return {
    templates,
    history,
    email,
    prepare,
    log,
    sendEmail,
    copyAndLog,
    openExternally,
    addTemplate,
    editTemplate,
    removeTemplate,
  };
}

export function usePersonCommunications(personId: PersonId) {
  const snapshot = useSnapshot();
  return useMemo(() => communicationsForPerson(snapshot, personId), [snapshot, personId]);
}
