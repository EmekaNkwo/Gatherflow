import { editDistance, normalise, normaliseEmail, normalisePhone } from "@/lib/strings";
import type { Person } from "@/types/person";

export interface DuplicateCandidateInput {
  firstName: string;
  lastName: string;
  phone?: string;
  email?: string;
  /** Excluded from the results, so editing a record never matches itself. */
  excludeId?: string;
}

export type DuplicateConfidence = "high" | "medium" | "low";

export interface DuplicateMatch {
  person: Person;
  confidence: DuplicateConfidence;
  /** Plain-language explanation shown next to the suggestion. */
  reason: string;
}

/**
 * Suggests people who may already be in the directory.
 *
 * This only ever *suggests*: the volunteer decides. Registration is never
 * blocked, because two people really can share a name.
 */
export function findPotentialDuplicates(
  people: readonly Person[],
  input: DuplicateCandidateInput,
  limit = 5,
): DuplicateMatch[] {
  const phone = normalisePhone(input.phone);
  const email = normaliseEmail(input.email);
  const firstName = normalise(input.firstName);
  const lastName = normalise(input.lastName);

  if (!firstName && !lastName && !phone && !email) return [];

  const matches: DuplicateMatch[] = [];

  for (const person of people) {
    if (person.id === input.excludeId) continue;

    const candidatePhone = normalisePhone(person.phone);
    const candidateEmail = normaliseEmail(person.email);
    const candidateFirst = normalise(person.firstName);
    const candidateLast = normalise(person.lastName);

    if (phone && candidatePhone && candidatePhone === phone) {
      matches.push({
        person,
        confidence: "high",
        reason: "Same phone number",
      });
      continue;
    }

    if (email && candidateEmail && candidateEmail === email) {
      matches.push({ person, confidence: "high", reason: "Same email address" });
      continue;
    }

    if (firstName && lastName && candidateFirst === firstName && candidateLast === lastName) {
      matches.push({ person, confidence: "high", reason: "Same first and last name" });
      continue;
    }

    if (lastName && candidateLast === lastName && firstName) {
      const distance = editDistance(candidateFirst, firstName);
      if (distance <= 2) {
        matches.push({
          person,
          confidence: "medium",
          reason: `Same last name and a very similar first name (${person.firstName})`,
        });
        continue;
      }
      matches.push({
        person,
        confidence: "low",
        reason: "Same last name",
      });
      continue;
    }

    if (firstName && lastName && candidateFirst === firstName) {
      const distance = editDistance(candidateLast, lastName);
      if (distance <= 2) {
        matches.push({
          person,
          confidence: "medium",
          reason: `Same first name and a very similar last name (${person.lastName})`,
        });
      }
    }
  }

  const weight: Record<DuplicateConfidence, number> = { high: 0, medium: 1, low: 2 };
  return matches
    .sort((left, right) => weight[left.confidence] - weight[right.confidence])
    .slice(0, limit);
}

/** Convenience flag for the quick-registration form. */
export function hasLikelyDuplicate(matches: readonly DuplicateMatch[]): boolean {
  return matches.some((match) => match.confidence === "high");
}
