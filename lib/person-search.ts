import type { Person } from "@/types/person";
import { normalisePhone } from "./strings";

/**
 * Person search, one definition for every list and the palette.
 *
 * - accents and case are ignored ("emilie" finds "Émilie"), as are
 *   apostrophes and hyphens ("obrien" finds "O'Brien-Núñez");
 * - every word typed must appear somewhere ("ama ok" finds "Amara Okafor"),
 *   across first, preferred and last name, email and member reference;
 * - a query that looks like a phone number matches however the number was
 *   typed ("07700 111001" finds "+44 7700 111001").
 */
export function foldForSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/['’`\-.]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const PHONE_QUERY = /^[+\d][\d\s()-]{5,}$/;

type Searchable = Pick<Person, "firstName" | "lastName" | "preferredName" | "phone" | "email"> & {
  member?: { reference?: string };
};

export function matchesPersonQuery(person: Searchable, query: string): boolean {
  const trimmed = query.trim();
  if (!trimmed) return true;

  if (PHONE_QUERY.test(trimmed)) {
    const wanted = normalisePhone(trimmed);
    if (wanted.length >= 6 && normalisePhone(person.phone).includes(wanted)) return true;
  }

  const haystack = foldForSearch(
    [
      person.firstName,
      person.preferredName ?? "",
      person.lastName,
      person.email ?? "",
      person.member?.reference ?? "",
      person.phone ?? "",
    ].join(" "),
  );
  return foldForSearch(trimmed)
    .split(" ")
    .every((word) => haystack.includes(word));
}
