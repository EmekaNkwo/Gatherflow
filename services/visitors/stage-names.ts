import type { PipelineStage } from "@/types/follow-up";

/**
 * Plain words for the default visitor-journey stages, shown everywhere a
 * stage is named. A stage the church has renamed keeps the church's own
 * name, so this never hides a deliberate choice.
 */
const PLAIN_STAGE_NAMES: Readonly<Record<string, { defaultName: string; plain: string }>> = {
  new_visitor: { defaultName: "New visitor", plain: "Just visited" },
  contact_pending: { defaultName: "Contact pending", plain: "Waiting for a hello" },
  contact_attempted: { defaultName: "Contact attempted", plain: "Tried to reach" },
  contacted: { defaultName: "Contacted", plain: "Spoken to" },
  invited_to_return: { defaultName: "Invited to return", plain: "Invited back" },
  returned: { defaultName: "Returned", plain: "Came back" },
  membership_orientation: { defaultName: "Membership orientation", plain: "Exploring membership" },
  connected: { defaultName: "Connected", plain: "Settled in" },
  closed: { defaultName: "Closed", plain: "Follow-up stopped" },
};

export function plainStageName(stage: Pick<PipelineStage, "id" | "name">): string {
  const known = PLAIN_STAGE_NAMES[stage.id];
  return known && known.defaultName === stage.name ? known.plain : stage.name;
}
