/** Whether an invitation went out by email, and why not when it did not. */
export type InvitationDelivery = { emailed: true } | { emailed: false; reason: string };
