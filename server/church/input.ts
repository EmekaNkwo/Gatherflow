import type { z } from "zod";
import { err, ok, type Result } from "@/lib/result";

/**
 * Validation at the request boundary.
 *
 * The domain commands take typed input and trust it, which was safe while the
 * only caller was a form in the same program: TypeScript guaranteed the shape.
 * A request body guarantees nothing. An unknown enum value reaches a lookup
 * table and throws, which would turn a bad request into a 500.
 *
 * So every command input coming from a client is parsed here first, and a
 * failure becomes an ordinary refusal — the same shape the rest of the system
 * uses — rather than an exception.
 */
export const INVALID_INPUT = "invalid_input";

export function parseCommandInput<T>(
  schema: z.ZodType<T>,
  raw: unknown,
): Result<T> {
  const parsed = schema.safeParse(raw);
  if (parsed.success) return ok(parsed.data);

  // The first problem is the useful one; a list of fifteen is not actionable.
  const [issue] = parsed.error.issues;
  return err(describeIssue(issue), INVALID_INPUT);
}

/** "dueInDays" → "Due in days": the field as a person would name it. */
function fieldLabel(path: readonly PropertyKey[]): string {
  const last = [...path].reverse().find((part) => typeof part === "string");
  if (typeof last !== "string") return "That value";
  const words = last.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * A validation problem as a sentence somebody can act on — never the
 * library's own wording, which names types and operators.
 */
export function describeIssue(issue: z.core.$ZodIssue | undefined): string {
  if (!issue) return "Something in that request was not valid.";
  const field = fieldLabel(issue.path);

  switch (issue.code) {
    case "too_big":
      if (issue.origin === "string") return `${field} is too long (${String(issue.maximum)} characters at most).`;
      if (issue.origin === "array") return `Too many chosen at once (${String(issue.maximum)} at most).`;
      return `${field} must be ${String(issue.maximum)} or less.`;
    case "too_small":
      if (issue.origin === "string") return Number(issue.minimum) <= 1 ? `${field} is needed.` : `${field} is too short.`;
      if (issue.origin === "array") return "Choose at least one.";
      return `${field} must be ${String(issue.minimum)} or more.`;
    case "invalid_value":
      return `${field} isn't one of the choices on offer.`;
    case "invalid_type":
      return issue.input === undefined ? `${field} is needed.` : `${field} isn't valid.`;
    case "custom":
    case "invalid_format":
      // Our own refinements carry a sentence already ("must be a real date").
      return issue.message.startsWith("must") ? `${field} ${issue.message}.` : `${field} isn't valid.`;
    default:
      return `${field} isn't valid.`;
  }
}
