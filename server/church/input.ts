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
  const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
  return err(`That request was not valid. ${where}${issue?.message ?? ""}`.trim(), INVALID_INPUT);
}
