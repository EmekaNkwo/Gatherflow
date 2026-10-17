import type { ContactMethod } from "@/types/common";
import type { Person } from "@/types/person";

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
  if (!person.contact.permissionGranted) return { kind: "refused", reason: "Hasn't agreed to be contacted" };

  const order: ContactMethod[] = [person.contact.preferredMethod, "phone", "email"];
  const links = [...new Set(order)]
    .map((method) => linkFor(method, person))
    .filter((link): link is ContactLink => link !== null)
    .slice(0, 2);
  if (links.length === 0) return { kind: "none", reason: "No phone number or email yet" };
  return { kind: "ok", links };
}
