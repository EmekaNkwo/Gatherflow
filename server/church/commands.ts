import { createSeedSnapshot } from "@/data/seed";
import { err, ok, type Result } from "@/lib/result";
import { runAutomations } from "@/services/automation/rules";
import { createCommandContext } from "@/services/core/context";
import type { CommandResult } from "@/services/core/events";
import {
  CONFLICT,
  FULL_SCOPE,
  type AsyncSnapshotRepository,
  type VersionedSnapshot,
} from "@/services/repositories/async-snapshot-repository";
import type { TeamMemberId } from "@/types/common";
import type { Capability } from "@/types/team";
import type { ChurchSnapshot } from "@/types/snapshot";
import { authorize, scopeFor } from "@/server/auth/authorize";
import type { ChurchSession } from "@/server/auth/session";
import type { Database } from "@/server/db/client";
import { createPostgresSnapshotRepository } from "@/server/db/snapshot-repository";

/**
 * The server-side command path.
 *
 * It mirrors the browser store exactly — command, then automations once
 * against the events the command reported, then persist — so the business
 * rules behave identically whichever side runs them. What it adds is the two
 * things a browser cannot be trusted with: the capability check, and a commit
 * guarded by the version that was read.
 */

/** How many times a commit is retried after losing a concurrency race. */
const MAX_ATTEMPTS = 3;

export interface ChurchContext {
  db: Database;
  session: ChurchSession;
}

export type Command = (
  snapshot: ChurchSnapshot,
  ctx: ReturnType<typeof createCommandContext>,
) => Result<CommandResult>;

function repositoryFor({ db, session }: ChurchContext): AsyncSnapshotRepository {
  return createPostgresSnapshotRepository({
    db,
    churchId: session.churchId,
    createSeed: () => createSeedSnapshot(new Date()),
  });
}

/**
 * Reads the church as this session is allowed to see it.
 *
 * The scope is applied in the query — a volunteer's request does not fetch
 * other people's tasks, and a request without `care.read` does not fetch the
 * care table at all.
 */
export async function readChurch(context: ChurchContext): Promise<VersionedSnapshot> {
  return repositoryFor(context).load(scopeFor(context.session));
}

/**
 * Authorises, runs and commits a command.
 *
 * The command itself runs against the *full* snapshot, never the scoped one:
 * the rules need every task to spot a duplicate automation key, and every
 * attendance row to count a visit. Narrowing what a caller may read must not
 * narrow what the rules can reason about, or they would quietly draw the wrong
 * conclusion. What comes back is scoped again before it leaves.
 */
/** The actor recorded when the server acts on a provider's report. */
export const SYSTEM_ACTOR = "system" as TeamMemberId;

/**
 * Runs a command with no user session.
 *
 * Used for exactly one thing: applying what an email provider told us — a
 * bounce, a complaint, an unsubscribe. There is no user to authorise, and
 * refusing would mean ignoring somebody's explicit request not to be
 * contacted, so there is no capability check here.
 *
 * It is deliberately a separate function rather than a flag on `runCommand`,
 * so that every caller that skips authorisation is visible by name.
 */
export async function runSystemCommand(
  db: Database,
  churchId: string,
  command: Command,
): Promise<Result<CommandResult>> {
  const repository = createPostgresSnapshotRepository({
    db,
    churchId,
    createSeed: () => createSeedSnapshot(new Date()),
  });

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const current = await repository.load(FULL_SCOPE);
    const ctx = createCommandContext({ actorId: SYSTEM_ACTOR });

    const outcome = command(current.snapshot, ctx);
    if (!outcome.ok) return outcome;

    const automated = runAutomations(outcome.value.snapshot, outcome.value.events, ctx);
    const saved = await repository.save(
      current.snapshot,
      automated.snapshot,
      current.version,
    );

    if (saved.ok) {
      return ok({
        ...outcome.value,
        snapshot: automated.snapshot,
        notices: [...outcome.value.notices, ...automated.notices],
      });
    }
    if (saved.code !== CONFLICT) return saved;
  }

  return err("Could not apply the provider's report; it will be retried.", CONFLICT);
}

export async function runCommand(
  context: ChurchContext,
  capability: Capability,
  command: Command,
): Promise<Result<CommandResult>> {
  const permitted = authorize(context.session, capability);
  if (!permitted.ok) return permitted;

  const repository = repositoryFor(context);

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const current = await repository.load(FULL_SCOPE);

    const ctx = createCommandContext({
      actorId: (context.session.teamMemberId ?? context.session.userId) as TeamMemberId,
    });

    const outcome = command(current.snapshot, ctx);
    if (!outcome.ok) return outcome;

    // Automations run exactly once per command, against the events the
    // command reported — never off the back of a render.
    const automated = runAutomations(outcome.value.snapshot, outcome.value.events, ctx);
    const notices = [...outcome.value.notices, ...automated.notices];

    const saved = await repository.save(
      current.snapshot,
      automated.snapshot,
      current.version,
    );

    if (saved.ok) {
      return ok({ ...outcome.value, snapshot: automated.snapshot, notices });
    }

    // Anything other than losing the race is a real failure.
    if (saved.code !== CONFLICT) return saved;
  }

  return err(
    "That change kept colliding with other people's saves. Please try again.",
    CONFLICT,
  );
}
