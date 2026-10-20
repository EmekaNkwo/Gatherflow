import type { IsoDate, PersonId, SessionId, TaskId } from "@/types/common";
import type { TaskOutcome } from "@/types/follow-up";
import type { ChurchSnapshot } from "@/types/snapshot";

/**
 * Commands describe what happened as explicit domain events. The automation
 * engine reacts to these events rather than diffing state, so a rule runs
 * exactly once per real-world occurrence — never again because a component
 * re-rendered.
 */
export type DomainEvent =
  | { type: "visitor.registered"; personId: PersonId; firstVisitDate: IsoDate }
  | { type: "visitor.returned"; personId: PersonId; sessionId?: SessionId; visitCount: number }
  | { type: "visitor.membership_interest"; personId: PersonId }
  | { type: "visitor.stage_changed"; personId: PersonId; stageId: string }
  | { type: "visitor.follow_up_stopped"; personId: PersonId }
  | { type: "task.completed"; taskId: TaskId; personId: PersonId; outcome: TaskOutcome }
  | { type: "member.registered"; personId: PersonId };

export interface CommandResult {
  snapshot: ChurchSnapshot;
  events: DomainEvent[];
  /** Short, user-facing notes about what the command did. */
  notices: string[];
}

export function result(
  snapshot: ChurchSnapshot,
  events: DomainEvent[] = [],
  notices: string[] = [],
): CommandResult {
  return { snapshot, events, notices };
}
