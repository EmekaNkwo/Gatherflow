import { err, ok, type Result } from "@/lib/result";
import { renderTemplate } from "@/services/communications/template-engine";
import { createCommandContext } from "@/services/core/context";
import type { CommandResult } from "@/services/core/events";
import { authorize } from "@/server/auth/authorize";
import type { ChurchSession } from "@/server/auth/session";
import { CONFLICT, FULL_SCOPE } from "@/services/repositories/async-snapshot-repository";
import { createSeedSnapshot } from "@/data/seed";
import type { Database } from "@/server/db/client";
import { createPostgresSnapshotRepository } from "@/server/db/snapshot-repository";
import { runAutomations } from "@/services/automation/rules";
import type { PersonId, TaskId, TemplateId } from "@/types/common";
import { insertOutboxRow, isSuppressed, queueEmailCommand, SUPPRESSED } from "./outbox";

/**
 * Sending an email, as a request.
 *
 * Nothing is handed to the provider here. The communication record and the
 * queue row are committed together and a worker takes it from there, so a
 * request cannot half-send: either the church has a record and a queued
 * message, or it has neither.
 */

export interface SendEmailInput {
  personId: PersonId;
  templateId: TemplateId;
  taskId?: TaskId;
  subject?: string;
  serviceName?: string;
  serviceDate?: string;
  groupName?: string;
}

export interface SendEmailOutcome {
  communicationId: string;
  outboxId: string;
  toEmail: string;
}

const MAX_ATTEMPTS = 3;

export async function sendTemplatedEmail(
  db: Database,
  session: ChurchSession,
  input: SendEmailInput,
): Promise<Result<SendEmailOutcome>> {
  const permitted = authorize(session, "communications.write");
  if (!permitted.ok) return permitted;

  const repository = createPostgresSnapshotRepository({
    db,
    churchId: session.churchId,
    createSeed: () => createSeedSnapshot(new Date()),
  });

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const current = await repository.load(FULL_SCOPE);
    const snapshot = current.snapshot;

    const person = snapshot.people.find((entry) => entry.id === input.personId);
    if (!person) return err("That person is no longer in the directory.", "not_found");

    const template = snapshot.templates.find((entry) => entry.id === input.templateId);
    if (!template) return err("That template no longer exists.", "not_found");

    // Checked before the consent rules only because it needs the database;
    // either refusal stops the send.
    if (person.email && (await isSuppressed(db, session.churchId, person.email))) {
      return err(
        `${person.email} is on this church's suppression list — it bounced, was reported as spam, or they unsubscribed.`,
        SUPPRESSED,
      );
    }

    const ctx = createCommandContext({
      actorId: session.teamMemberId ?? session.userId,
    });

    const sender = snapshot.team.find((member) => member.id === ctx.actorId);
    const rendered = renderTemplate(template.body, {
      person,
      churchName: snapshot.settings.churchName,
      senderName: sender?.name ?? "the church team",
      serviceDate: input.serviceDate ?? person.visitor?.firstVisitDate,
      serviceName: input.serviceName ?? "our Sunday service",
      groupName: input.groupName,
    });

    if (rendered.missing.length) {
      return err(
        `That message still has unfilled placeholders: ${rendered.missing.join(", ")}.`,
        "incomplete",
      );
    }

    const queued = queueEmailCommand(
      snapshot,
      {
        personId: input.personId,
        subject: input.subject ?? `${snapshot.settings.churchName}`,
        htmlPart: toHtml(rendered.text),
        textPart: rendered.text,
        templateId: template.id,
        taskId: input.taskId,
      },
      ctx,
    );
    if (!queued.ok) return queued;

    const automated = runAutomations(queued.value.snapshot, queued.value.events, ctx);

    const saved = await repository.save(snapshot, automated.snapshot, current.version, {
      // The queue row lands in the commit's own transaction. If the commit is
      // rolled back the queued message goes with it.
      enlist: async (tx) =>
        insertOutboxRow(tx as Database, {
          churchId: session.churchId,
          queued: queued.value.queued,
          personId: input.personId,
          input: {
            personId: input.personId,
            subject: input.subject ?? snapshot.settings.churchName,
            htmlPart: toHtml(rendered.text),
            textPart: rendered.text,
            templateId: template.id,
            taskId: input.taskId,
          },
        }),
    });

    if (saved.ok) return ok(queued.value.queued);
    if (saved.code !== CONFLICT) return saved;
  }

  return err("That message collided with other saves. Please try again.", CONFLICT);
}

/**
 * Wraps the rendered text as minimal HTML.
 *
 * Deliberately plain: the message a volunteer wrote is the message that gets
 * sent, and escaping it means a name containing an ampersand cannot break the
 * markup or inject anything.
 */
export function toHtml(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  const paragraphs = escaped
    .split(/\n{2,}/)
    .map((block) => `<p>${block.replace(/\n/g, "<br />")}</p>`)
    .join("\n");

  return `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5">\n${paragraphs}\n</div>`;
}

export type { CommandResult };
