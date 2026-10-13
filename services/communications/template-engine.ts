import { formatDisplayDate } from "@/lib/dates";
import { displayName } from "@/lib/strings";
import type { IsoDate, IsoDateTime } from "@/types/common";
import type { TemplatePlaceholder } from "@/types/communication";
import type { Person } from "@/types/person";

export interface TemplateContext {
  person: Pick<Person, "firstName" | "lastName" | "preferredName">;
  churchName: string;
  senderName: string;
  serviceDate?: IsoDate | IsoDateTime;
  serviceName?: string;
  groupName?: string;
}

export interface RenderedTemplate {
  text: string;
  /** Placeholders the context could not fill — surfaced before sending. */
  missing: TemplatePlaceholder[];
  /** Placeholders in the body that the engine does not understand. */
  unknown: string[];
}

/**
 * Renders `{{placeholder}}` tokens.
 *
 * Unresolved tokens are left visible in the output rather than silently
 * blanked, so nobody sends "Hello , thank you for visiting".
 */
export function renderTemplate(body: string, context: TemplateContext): RenderedTemplate {
  const values: Partial<Record<TemplatePlaceholder, string | undefined>> = {
    firstName: context.person.preferredName?.trim() || context.person.firstName,
    preferredName: displayName(context.person),
    churchName: context.churchName,
    senderName: context.senderName,
    serviceDate: context.serviceDate ? formatDisplayDate(context.serviceDate) : undefined,
    serviceName: context.serviceName,
    groupName: context.groupName,
  };

  const missing = new Set<TemplatePlaceholder>();
  const unknown = new Set<string>();

  const text = body.replace(/\{\{\s*([\w]+)\s*\}\}/g, (token, rawKey: string) => {
    if (!(rawKey in values)) {
      unknown.add(rawKey);
      return token;
    }
    const key = rawKey as TemplatePlaceholder;
    const value = values[key];
    if (!value) {
      missing.add(key);
      return token;
    }
    return value;
  });

  return { text, missing: Array.from(missing), unknown: Array.from(unknown) };
}

/** Placeholders referenced by a template body, in order of first use. */
export function placeholdersIn(body: string): string[] {
  const found: string[] = [];
  const pattern = /\{\{\s*([\w]+)\s*\}\}/g;
  let match = pattern.exec(body);
  while (match) {
    if (!found.includes(match[1])) found.push(match[1]);
    match = pattern.exec(body);
  }
  return found;
}
