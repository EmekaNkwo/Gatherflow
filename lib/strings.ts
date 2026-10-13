import type { Person } from "@/types/person";

/** Name, text and matching helpers shared by search, tables and exports. */

export function fullName(person: Pick<Person, "firstName" | "lastName">): string {
  return `${person.firstName} ${person.lastName}`.trim();
}

/** Preferred name wins for anything the person will read or hear. */
export function displayName(
  person: Pick<Person, "firstName" | "lastName" | "preferredName">,
): string {
  const first = person.preferredName?.trim() || person.firstName;
  return `${first} ${person.lastName}`.trim();
}

export function initials(
  person: Pick<Person, "firstName" | "lastName">,
): string {
  return `${person.firstName.charAt(0)}${person.lastName.charAt(0)}`.toUpperCase();
}

export function normalise(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Comparable form of a phone number: digits only, reduced to the last nine.
 * That makes `+44 7700 900123`, `07700 900123` and `7700900123` all match,
 * which is what duplicate detection needs from numbers typed in a hurry at
 * a welcome desk.
 */
export function normalisePhone(value?: string): string {
  if (!value) return "";
  const digits = value.replace(/\D/g, "");
  return digits.length > 9 ? digits.slice(-9) : digits;
}

export function normaliseEmail(value?: string): string {
  return value ? value.trim().toLowerCase() : "";
}

/** Levenshtein distance, capped for short strings used in name matching. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);

  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, substitution);
    }
    previous = current;
  }

  return previous[b.length];
}

export function titleCase(value: string): string {
  return value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

export function pluralise(count: number, singular: string, plural?: string): string {
  return count === 1 ? singular : (plural ?? `${singular}s`);
}

export function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
