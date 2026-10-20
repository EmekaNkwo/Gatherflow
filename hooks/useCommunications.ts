"use client";

import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import type { ContactMethod, PersonId, TaskId, TemplateId } from "@/types/common";
import type { ManualCommunicationStatus } from "@/types/communication";
import type { Result } from "@/lib/result";
import {
  buildExternalLink,
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

  /**
   * The link for the words as they stand now. Built when it is needed, never
   * stored, so an edit in the composer is exactly what the app receives.
   */
  const linkFor = useCallback(
    (draft: MessageDraft, body: string): string | undefined => {
      const person = snapshot.people.find((entry) => entry.id === draft.personId);
      if (!person) return undefined;
      return buildExternalLink(
        draft.channel,
        person.phone,
        person.email,
        body,
        snapshot.settings.defaultCountryCallingCode,
      );
    },
    [snapshot],
  );

  /**
   * Records the hand-over first and only then copies or opens. The server is
   * the one that knows whether the person has since opted out, so nothing
   * leaves the app until it has agreed. Its refusal is shown as a toast.
   */
  const recordFirst = useCallback(
    async (draft: MessageDraft, body: string, status: ManualCommunicationStatus, taskId?: TaskId) => {
      const outcome = await dispatch(
        "communication.log",
        { personId: draft.personId, channel: draft.channel, status, body, templateId: draft.templateId, taskId },
        { silent: true },
      );
      return outcome.ok;
    },
    [dispatch],
  );

  /** Copies the final text once the server has accepted the record. */
  const copyAndLog = useCallback(
    async (draft: MessageDraft, body: string, taskId?: TaskId): Promise<boolean> => {
      if (!(await recordFirst(draft, body, "copied", taskId))) return false;
      try {
        await navigator.clipboard.writeText(body);
      } catch {
        toast.error("Could not reach the clipboard. Select the text and copy it yourself.");
        return false;
      }
      toast.success("Copied");
      return true;
    },
    [recordFirst],
  );

  /** Opens the person's own messaging app once the server has accepted the record. */
  const openExternally = useCallback(
    async (draft: MessageDraft, body: string, taskId?: TaskId): Promise<boolean> => {
      const link = linkFor(draft, body);
      if (!link) {
        toast.error("There's no usable contact detail for that way of sending.");
        return false;
      }
      if (!(await recordFirst(draft, body, "opened_external", taskId))) return false;
      // Web links open beside the app; mailto, sms and tel hand over in place,
      // which no popup blocker stops.
      if (link.startsWith("https://")) window.open(link, "_blank", "noopener,noreferrer");
      else window.location.assign(link);
      toast.success("Opened in your messaging app");
      return true;
    },
    [linkFor, recordFirst],
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
    linkFor,
    addTemplate,
    editTemplate,
    removeTemplate,
  };
}

export function usePersonCommunications(personId: PersonId) {
  const snapshot = useSnapshot();
  return useMemo(() => communicationsForPerson(snapshot, personId), [snapshot, personId]);
}
