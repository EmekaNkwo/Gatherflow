import { titleCase } from "@/lib/strings";

/**
 * Plain words for the audit trail.
 *
 * The audit table keeps action names (`settings.upsertTeamMember`) and ids;
 * this turns them into something an administrator can read. Pure, so the
 * server can use the same helpers when it writes an entry.
 */

const ACTION_LABELS: Record<string, string> = {
  "visitor.register": "Registered a visitor",
  "visitor.recordReturnVisit": "Recorded a return visit",
  "visitor.assign": "Assigned a visitor",
  "visitor.setStage": "Moved a visitor to another stage",
  "visitor.closeFollowUp": "Closed a visitor's follow-up",
  "visitor.reopenFollowUp": "Reopened a visitor's follow-up",
  "visitor.setContactPreferences": "Changed contact preferences",
  "visitor.recordMembershipInterest": "Recorded interest in membership",
  "visitor.bulkAssign": "Assigned several visitors",
  "visitor.self_register": "Visitor signed in on the welcome page",
  "task.create": "Added a follow-up",
  "task.createForPeople": "Added follow-ups for several people",
  "task.complete": "Completed a follow-up",
  "task.reschedule": "Rescheduled a follow-up",
  "task.assign": "Assigned a follow-up",
  "task.start": "Started a follow-up",
  "task.cancel": "Cancelled a follow-up",
  "member.register": "Added a member",
  "member.changeStatus": "Changed a member's status",
  "member.recordOrientationCompleted": "Recorded orientation as done",
  "member.setEmergencyContact": "Changed an emergency contact",
  "member.setRequestedContact": "Changed how someone wants to be contacted",
  "person.correct": "Corrected someone's details",
  "person.delete": "Deleted a person's record",
  "person.setHousehold": "Changed someone's household",
  "household.create": "Added a household",
  "session.create": "Added a service",
  "session.update": "Changed a service",
  "session.delete": "Removed a service",
  "session.updateNotes": "Changed service notes",
  "attendance.record": "Checked someone in",
  "attendance.remove": "Removed a check-in",
  "attendance.move": "Moved a check-in",
  "attendance.importCsv": "Imported attendance",
  "group.create": "Added a group",
  "group.addMember": "Added someone to a group",
  "group.removeMember": "Took someone out of a group",
  "group.setLeader": "Changed a group leader",
  "group.setActive": "Opened or paused a group",
  "communication.log": "Recorded a message",
  "communication.logMany": "Recorded a message to several people",
  "template.create": "Added a message template",
  "template.update": "Changed a message template",
  "template.delete": "Deleted a message template",
  "care.create": "Opened a pastoral-care record",
  "care.update": "Changed a pastoral-care record",
  "care.addNote": "Added a pastoral-care note",
  "care.scheduleAppointment": "Booked a pastoral-care visit",
  "care.setAppointmentStatus": "Updated a pastoral-care visit",
  "settings.update": "Changed settings",
  "settings.updateProfile": "Changed the church's details",
  "settings.updateAutomationRule": "Changed an automation rule",
  "settings.updateEngagement": "Changed the engagement limits",
  "settings.updatePipelineStages": "Changed the pipeline stages",
  "settings.updateServices": "Changed the weekly services",
  "settings.upsertTeamMember": "Added or changed a team member",
  "settings.setTeamMemberActive": "Switched a team member on or off",
  "settings.reassignOpenTasks": "Moved someone's open follow-ups",
  "invitation.create": "Invited someone",
  "invitation.email": "Emailed an invitation",
  "invitation.revoke": "Withdrew an invitation",
  "invitation.accept": "Accepted an invitation",
  "membership.role": "Changed an account's role",
  "membership.remove": "Removed an account",
  "church.create": "Created the church",
  "account.delete": "Deleted an account",
  "email.send": "Sent an email",
  "email.unsubscribe_link": "Someone unsubscribed by link",
  "email.provider_opt_out": "The email provider reported an opt-out",
  "ops.backup": "Backed up the church",
  "ops.restore": "Restored the church from a backup",
  "ops.repairVisits": "Corrected first-visit records",
};

/** A readable sentence for an action, falling back to tidied words. */
export function describeAction(action: string): string {
  return ACTION_LABELS[action] ?? titleCase(action.replace(/\./g, " ").replace(/([a-z])([A-Z])/g, "$1 $2"));
}

/**
 * `jane.doe@example.com` → `j•••@example.com`. Enough for an administrator
 * to recognise who was invited, without the trail holding the full address.
 */
export function maskEmail(email: string): string {
  const [local, domain] = email.trim().toLowerCase().split("@");
  if (!local || !domain) return "•••";
  return `${local.charAt(0)}•••@${domain}`;
}

/** Separates a target id from the one detail kept with it, such as a role. */
const DETAIL_SEPARATOR = "|";

/**
 * A target that carries one short, non-sensitive detail with it — the role
 * an invitation offered, or the new role an account was given — in the one
 * text column the audit table has for it.
 */
export function auditTarget(id: string, detail?: string | null): string {
  return detail ? `${id}${DETAIL_SEPARATOR}${detail}` : id;
}

export function parseAuditTarget(targetId: string | null): { id: string | null; detail: string | null } {
  if (!targetId) return { id: null, detail: null };
  const at = targetId.indexOf(DETAIL_SEPARATOR);
  return at < 0 ? { id: targetId, detail: null } : { id: targetId.slice(0, at), detail: targetId.slice(at + 1) };
}
