import type { ContactMethod } from "@/types/common";
import type { FollowUpTaskType } from "@/types/follow-up";
import type { Person } from "@/types/person";

/**
 * Consent, in one place: somebody may be contacted only when they agreed to
 * it and have not since opted out. Automation rules, task creation and the
 * follow-up cards all ask this, so they can never disagree.
 */
export function canBeContacted(person: Pick<Person, "contact">): boolean {
  return person.contact.permissionGranted && !person.contact.optedOut;
}

/**
 * Follow-ups that never message anybody, so need no permission to contact:
 * a hello in person at the next service, pastoral care (which has its own
 * rules), and membership orientation, which the person asked about themselves.
 */
const NO_PERMISSION_NEEDED: readonly FollowUpTaskType[] = [
  "say_hello",
  "pastoral_contact",
  "membership_orientation",
];

export function needsContactPermission(type: FollowUpTaskType): boolean {
  return !NO_PERMISSION_NEEDED.includes(type);
}

/** Task types that can be set up for this person, given their consent. */
export function allowedTaskTypes(
  person: Pick<Person, "contact">,
  types: readonly FollowUpTaskType[],
): FollowUpTaskType[] {
  return canBeContacted(person) ? [...types] : types.filter((type) => !needsContactPermission(type));
}

/**
 * The ways a volunteer can reach somebody straight from a follow-up card.
 *
 * Consent comes first: nothing is offered for a person who opted out or never
 * agreed to be contacted, and the card says why instead. Otherwise the way
 * they asked to be reached is first, with a plain call as the fallback.
 */
export interface ContactLink {
  method: ContactMethod;
  label: string;
  href: string;
}

export type ContactOptions =
  | { kind: "ok"; links: ContactLink[] }
  | { kind: "refused"; reason: string }
  | { kind: "none"; reason: string };

/** An address with nothing that a mail link would read as extra headers. */
const SAFE_EMAIL = /^[^\s?&=#%]+@[^\s?&=#%]+$/;

function dialable(phone: string): string {
  const trimmed = phone.trim();
  return `${trimmed.startsWith("+") ? "+" : ""}${trimmed.replace(/\D/g, "")}`;
}

function linkFor(method: ContactMethod, person: Person): ContactLink | null {
  const phone = person.phone ? dialable(person.phone) : null;
  switch (method) {
    case "phone":
      return phone ? { method, label: "Call", href: `tel:${phone}` } : null;
    case "sms":
      return phone ? { method, label: "Text", href: `sms:${phone}` } : null;
    case "whatsapp":
      // wa.me needs the full international number; a local one makes a dead link.
      return phone?.startsWith("+") ? { method, label: "WhatsApp", href: `https://wa.me/${phone.slice(1)}` } : null;
    case "email":
      return person.email && SAFE_EMAIL.test(person.email)
        ? { method, label: "Email", href: `mailto:${person.email}` }
        : null;
    case "in_person":
      return null;
  }
}

export function contactOptions(person: Person): ContactOptions {
  if (person.contact.optedOut) return { kind: "refused", reason: "Asked not to be contacted" };
  if (!canBeContacted(person)) return { kind: "refused", reason: "Hasn't agreed to be contacted" };

  const order: ContactMethod[] = [person.contact.preferredMethod, "phone", "email"];
  const links = [...new Set(order)]
    .map((method) => linkFor(method, person))
    .filter((link): link is ContactLink => link !== null)
    .slice(0, 2);
  if (links.length === 0) return { kind: "none", reason: "No phone number or email yet" };
  return { kind: "ok", links };
}
