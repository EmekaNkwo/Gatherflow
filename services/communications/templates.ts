import { err, ok, type Result } from "@/lib/result";
import type { ContactMethod, TemplateId } from "@/types/common";
import type { MessageTemplate, TemplateCategory } from "@/types/communication";
import { TEMPLATE_PLACEHOLDERS } from "@/types/communication";
import type { ChurchSnapshot } from "@/types/snapshot";
import type { CommandContext } from "../core/context";
import { result, type CommandResult } from "../core/events";
import { patch, replaceById } from "../core/snapshot";
import { placeholdersIn, strayBraces } from "./template-engine";

export interface TemplateInput {
  name: string;
  category: TemplateCategory;
  channels: readonly ContactMethod[];
  body: string;
}

function validate(input: TemplateInput): string | null {
  if (!input.name.trim()) return "Give the template a name.";
  if (!input.body.trim()) return "Write the message body.";
  if (!input.channels.length) return "Choose at least one channel.";

  const unknown = placeholdersIn(input.body).filter(
    (placeholder) => !(TEMPLATE_PLACEHOLDERS as readonly string[]).includes(placeholder),
  );
  if (unknown.length) {
    return `Unknown placeholder${unknown.length === 1 ? "" : "s"}: ${unknown
      .map((entry) => `{{${entry}}}`)
      .join(", ")}.${suggestionFor(unknown[0])}`;
  }
  const stray = strayBraces(input.body);
  if (stray.length) {
    return `${stray.join(", ")} ${stray.length === 1 ? "isn't a placeholder" : "aren't placeholders"}. Write placeholders exactly like {{firstName}}, or remove the braces.`;
  }
  return null;
}

/** A gentle hint when the only mistake is capital letters, e.g. `{{firstname}}`. */
function suggestionFor(unknown: string): string {
  const match = TEMPLATE_PLACEHOLDERS.find((entry) => entry.toLowerCase() === unknown.toLowerCase());
  return match ? ` Did you mean {{${match}}}?` : "";
}

export function createTemplate(
  snapshot: ChurchSnapshot,
  input: TemplateInput,
  ctx: CommandContext,
): Result<CommandResult & { templateId: TemplateId }> {
  const problem = validate(input);
  if (problem) return err(problem, "invalid");

  const template: MessageTemplate = {
    id: ctx.id("template"),
    name: input.name.trim(),
    category: input.category,
    channels: input.channels,
    body: input.body.trim(),
    createdAt: ctx.nowIso,
    updatedAt: ctx.nowIso,
    builtIn: false,
  };

  return ok({
    ...result(patch(snapshot, { templates: [...snapshot.templates, template] }), [], [
      `${template.name} created.`,
    ]),
    templateId: template.id,
  });
}

export function updateTemplate(
  snapshot: ChurchSnapshot,
  templateId: TemplateId,
  input: TemplateInput,
  ctx: CommandContext,
): Result<CommandResult> {
  const template = snapshot.templates.find((entry) => entry.id === templateId);
  if (!template) return err("That template no longer exists.", "not_found");

  const problem = validate(input);
  if (problem) return err(problem, "invalid");

  return ok(
    result(
      patch(snapshot, {
        templates: replaceById(snapshot.templates, templateId, (entry) => ({
          ...entry,
          name: input.name.trim(),
          category: input.category,
          channels: input.channels,
          body: input.body.trim(),
          updatedAt: ctx.nowIso,
        })),
      }),
      [],
      [`${input.name.trim()} saved.`],
    ),
  );
}

/** Built-in templates can be edited but not removed. */
export function deleteTemplate(
  snapshot: ChurchSnapshot,
  templateId: TemplateId,
): Result<CommandResult> {
  const template = snapshot.templates.find((entry) => entry.id === templateId);
  if (!template) return err("That template no longer exists.", "not_found");
  if (template.builtIn) {
    return err("Built-in templates can be edited but not deleted.", "protected");
  }

  return ok(
    result(
      patch(snapshot, {
        templates: snapshot.templates.filter((entry) => entry.id !== templateId),
      }),
      [],
      [`${template.name} deleted.`],
    ),
  );
}

/** Templates that suit a channel, used to suggest wording. */
export function templatesForChannel(
  snapshot: ChurchSnapshot,
  channel: ContactMethod,
): MessageTemplate[] {
  return snapshot.templates.filter((template) => template.channels.includes(channel));
}
