/** Whether an invitation went out by email, and why not when it did not. */
/** `skipped` means email isn't set up here, so no send was attempted. */
export type InvitationDelivery = { emailed: true } | { emailed: false; reason: string; skipped?: boolean };
