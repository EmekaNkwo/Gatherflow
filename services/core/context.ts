import { toIsoDate } from "@/lib/dates";
import { createId, type IdFactory } from "@/lib/ids";
import type { IsoDate, IsoDateTime, TeamMemberId } from "@/types/common";

/**
 * Everything a domain command needs from the outside world: the current
 * time, an id generator and who is acting. Commands never read the clock or
 * generate ids themselves, which is what makes them testable.
 */
export interface CommandContext {
  now: Date;
  nowIso: IsoDateTime;
  today: IsoDate;
  id: IdFactory;
  actorId: TeamMemberId;
}

export interface CommandContextInput {
  actorId: TeamMemberId;
  now?: Date;
  id?: IdFactory;
}

export function createCommandContext(input: CommandContextInput): CommandContext {
  const now = input.now ?? new Date();
  return {
    now,
    nowIso: now.toISOString(),
    today: toIsoDate(now),
    id: input.id ?? createId,
    actorId: input.actorId,
  };
}
