import { z } from "zod";
import { registerVisitor } from "@/services/visitors/registration";
import { CONTACT_METHODS } from "@/types/common";
import { recordAudit, SYSTEM_USER } from "@/server/audit/audit";
import { parseCommandInput } from "@/server/church/input";
import { runSystemCommand } from "@/server/church/commands";
import { getDatabase } from "@/server/db/client";
import { consumeBudget } from "@/server/http/rate-limit";
import { clientAddress } from "@/server/http/client-address";
import { respondErr, respondOk, respondRateLimited } from "@/server/http/respond";

/**
 * The public welcome page's one write: a visitor registering themselves.
 *
 * No session — the person has never seen the application — so three other
 * things stand in for one. The church is named by an id that only appears
 * on the church's own welcome card. The honeypot field catches form bots.
 * And a per-address budget stops anybody filling a church with records
 * from a script. The budget is kept in Postgres, so it holds across every
 * instance of the application rather than per instance.
 */
const schema = z.object({
  churchId: z.string().min(1).max(200),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  phone: z.string().trim().max(32).optional(),
  email: z.string().trim().max(200).optional(),
  firstVisit: z.boolean().default(true),
  preferredMethod: z.enum(CONTACT_METHODS as unknown as [string, ...string[]]),
  permissionGranted: z.boolean(),
  /** Must be empty. Hidden from people, filled in by bots. */
  website: z.string().max(0).optional(),
});

/** Twenty registrations an hour from one address, for one church. */
const BUDGET = { window: 60 * 60, max: 20 };

export async function POST(request: Request): Promise<Response> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return respondErr("That request body was not valid JSON.", "invalid_input");
  }
  const input = parseCommandInput(schema, raw);
  if (!input.ok) return respondErr(input.error, input.code);
  const values = input.value;

  const db = getDatabase();
  const budget = await consumeBudget(db, `connect:${clientAddress(request)}:${values.churchId}`, BUDGET);
  if (!budget.allowed) {
    return respondRateLimited(
      budget.retryAfter ?? BUDGET.window,
      "Too many registrations from this connection. Please try again later.",
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const outcome = await runSystemCommand(db, values.churchId, (snapshot, ctx) =>
    registerVisitor(
      snapshot,
      {
        firstName: values.firstName,
        lastName: values.lastName,
        phone: values.phone || undefined,
        email: values.email || undefined,
        visitDate: today,
        // The welcome card is how they found the form; the record keeps the
        // `selfRegistered` flag for the fact that they filled it in themselves.
        source: "walk_in",
        preferredMethod: values.preferredMethod as (typeof CONTACT_METHODS)[number],
        permissionGranted: values.permissionGranted,
        selfRegistered: true,
        returningVisitor: !values.firstVisit,
      },
      ctx,
    ),
  );

  if (outcome.ok) {
    await recordAudit(db, {
      churchId: values.churchId,
      userId: SYSTEM_USER,
      action: "visitor.self_register",
      targetId: (outcome.value as { personId?: string }).personId ?? null,
      outcome: "ok",
    });
    // Nothing about the church or the record goes back: the person gets a
    // thank-you, not a confirmation that a particular church id exists.
    return respondOk({ registered: true });
  }
  // A wrong church id and a refused registration look the same from outside.
  return respondErr("That registration could not be saved.", "not_found");
}
