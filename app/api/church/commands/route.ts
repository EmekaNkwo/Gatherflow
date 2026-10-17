import { headers } from "next/headers";
import { err } from "@/lib/result";
import { auditResult, targetOf } from "@/server/audit/audit";
import { commandFor, isCommandName } from "@/services/commands/registry";
import { resolveChurchSession } from "@/server/auth/session";
import { readChurch, runCommand } from "@/server/church/commands";
import { parseCommandInput } from "@/server/church/input";
import { getDatabase } from "@/server/db/client";
import { respondErr, respondOk } from "@/server/http/respond";

/**
 * Command dispatch.
 *
 * The body names a command and supplies its input. Everything that decides
 * whether it may run comes from the server: the registry supplies the required
 * capability and the input schema, and the session supplies the role. Nothing
 * about authority or outcome is taken from the request.
 */
export async function POST(request: Request): Promise<Response> {
  const db = getDatabase();

  const session = await resolveChurchSession({ db, headers: await headers() });
  if (!session.ok) return respondErr(session.error, session.code);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return respondErr("That request body was not valid JSON.", "invalid_input");
  }

  const envelope = body as { name?: unknown; input?: unknown } | null;
  const name = envelope?.name;

  // An unknown name is refused before anything else looks at the input, so a
  // request cannot probe for commands that do not exist.
  if (!isCommandName(name)) {
    return respondErr("That is not a command this server knows.", "unknown_command");
  }

  const definition = commandFor(name);

  const input = parseCommandInput(definition.schema, envelope?.input);
  if (!input.ok) {
    await auditResult(db, { churchId: session.value.churchId, userId: session.value.userId, actorId: session.value.teamMemberId, action: name }, input);
    return respondErr(input.error, input.code);
  }

  let outcome: Awaited<ReturnType<typeof runCommand>>;
  try {
    outcome = await runCommand({ db, session: session.value }, definition.capability, (
      snapshot,
      ctx,
    ) => definition.run(snapshot, input.value, ctx));
  } catch (error: unknown) {
    outcome = err(
      `The change could not be saved: ${error instanceof Error ? error.message : String(error)}`,
      "storage_failed",
    );
  }

  // Every attempt is recorded, refused or not: "who tried" is as much a
  // part of the trail as "who did".
  await auditResult(
    db,
    {
      churchId: session.value.churchId,
      userId: session.value.userId,
      actorId: session.value.teamMemberId,
      action: name,
      targetId: targetOf(input.value),
    },
    outcome,
  );

  if (!outcome.ok) return respondErr(outcome.error, outcome.code);

  // The command ran against the whole church; what goes back is scoped again,
  // so a narrow caller does not receive rows it may not read.
  const scoped = await readChurch({ db, session: session.value });

  const { snapshot: _snapshot, events: _events, notices, ...data } = outcome.value;
  void _snapshot;
  void _events;

  return respondOk({
    snapshot: scoped.snapshot,
    notices,
    data,
  });
}

/** Kept so a stray GET gets an honest refusal rather than a framework error. */
export function GET(): Response {
  const refusal = err("Commands are sent with POST.", "unknown_command");
  return respondErr(refusal.error, refusal.code);
}
