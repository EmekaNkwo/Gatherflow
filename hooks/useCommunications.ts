"use client";

import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import type { ContactMethod, PersonId, TaskId, TemplateId } from "@/types/common";
import type { CommunicationStatus } from "@/types/communication";
import type { Result } from "@/lib/result";
import {
  communicationsForPerson,
  draftMessage,
  type DraftMessageInput,
  type MessageDraft,
} from "@/services/communications/messaging";
import { logCommunication } from "@/services/communications/messaging";
import {
  createTemplate,
  deleteTemplate,
  updateTemplate,
  type TemplateInput,
} from "@/services/communications/templates";
import { createCommandContext } from "@/services/core/context";
import { useSessionStore } from "@/stores/session-store";
import { useCommand, useSnapshot } from "./use-church-data";
import { useNow } from "./use-now";

/**
 * Message drafting and the communication log.
 *
 * Nothing here sends anything. Messages are drafted, copied or handed to an
 * app the user already has, and the log records exactly which of those
 * happened — it never claims delivery.
 */
export function useCommunications() {
  const snapshot = useSnapshot();
  const now = useNow();
  const { run } = useCommand();
  const teamMemberId = useSessionStore((state) => state.teamMemberId);

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
      draftMessage(snapshot, input, createCommandContext({ actorId: teamMemberId, now })),
    [snapshot, teamMemberId, now],
  );

  const log = useCallback(
    (input: {
      personId: PersonId;
      channel: ContactMethod;
      status: CommunicationStatus;
      body: string;
      templateId?: TemplateId;
      taskId?: TaskId;
    }) => run((snap, ctx) => logCommunication(snap, input, ctx)),
    [run],
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
      log({
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
      log({
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

  const simulateSend = useCallback(
    (draft: MessageDraft, taskId?: TaskId) =>
      log({
        personId: draft.personId,
        channel: draft.channel,
        status: "simulated_sent",
        body: draft.body,
        templateId: draft.templateId,
        taskId,
      }),
    [log],
  );

  const addTemplate = useCallback(
    (input: TemplateInput) => run((snap, ctx) => createTemplate(snap, input, ctx)),
    [run],
  );

  const editTemplate = useCallback(
    (templateId: TemplateId, input: TemplateInput) =>
      run((snap, ctx) => updateTemplate(snap, templateId, input, ctx)),
    [run],
  );

  const removeTemplate = useCallback(
    (templateId: TemplateId) => run((snap) => deleteTemplate(snap, templateId)),
    [run],
  );

  return {
    templates,
    history,
    prepare,
    log,
    copyAndLog,
    openExternally,
    simulateSend,
    addTemplate,
    editTemplate,
    removeTemplate,
  };
}

export function usePersonCommunications(personId: PersonId) {
  const snapshot = useSnapshot();
  return useMemo(() => communicationsForPerson(snapshot, personId), [snapshot, personId]);
}
