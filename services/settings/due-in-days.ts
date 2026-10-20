import { err, ok, type Result } from "@/lib/result";

/** Matches the server's limits on every "due in (days)" setting. */
export const DUE_IN_DAYS_MIN = 0;
export const DUE_IN_DAYS_MAX = 90;

/**
 * Reads a "due in (days)" box. An empty box is not 0 (due today): it is a
 * missing answer, and the person is asked for one. The messages are the ones
 * shown under the box, so they are written for the person typing.
 */
export function checkDueInDays(raw: string): Result<number> {
  const text = raw.trim();
  if (!text) return err("Enter a number of days, from 0 to 90.", "invalid");
  if (!/^\d+$/.test(text)) return err("Use a whole number of days, such as 3.", "invalid");
  const days = Number(text);
  if (days < DUE_IN_DAYS_MIN || days > DUE_IN_DAYS_MAX) {
    return err("Choose between 0 and 90 days.", "invalid");
  }
  return ok(days);
}
