import { formatDisplayDate } from "@/lib/dates";
import type { Result } from "@/lib/result";
import type { InvitationDelivery } from "@/types/account";
import { DEMO_ROLE_LABELS, type DemoRole } from "@/types/team";
import { sendSystemEmail, type SystemEmail } from "@/server/email/transactional";

/**
 * The invitation, delivered.
 *
 * Sent as system mail: the person asked for nothing yet, but an administrator
 * named them, and the message says who did and for which church. A failed
 * send is not a failed invitation — the link exists either way, and the
 * administrator is told to pass it on themselves.
 */
export interface InvitationEmailInput {
  to: string;
  churchName: string;
  inviterName: string;
  role: DemoRole;
  link: string;
  expiresAt: string;
}

export function composeInvitationEmail(input: InvitationEmailInput): SystemEmail {
  const inviter = input.inviterName.trim();
  const opening = inviter
    ? `${inviter} has invited you to join ${input.churchName} on GatherFlow`
    : `You have been invited to join ${input.churchName} on GatherFlow`;

  return {
    to: input.to,
    subject: `You're invited to join ${input.churchName} on GatherFlow`,
    text:
      `Hello,\n\n` +
      `${opening} as ${DEMO_ROLE_LABELS[input.role].toLowerCase()}.\n\n` +
      `To accept, open this link and sign in or create an account with this email address:\n\n` +
      `${input.link}\n\n` +
      `The link works until ${formatDisplayDate(input.expiresAt)}. ` +
      "If you were not expecting this, ignore the message; nothing happens unless you accept.",
  };
}

export async function sendInvitationEmail(
  input: InvitationEmailInput,
  send: (email: SystemEmail) => Promise<Result<void>> = sendSystemEmail,
): Promise<InvitationDelivery> {
  const sent = await send(composeInvitationEmail(input));
  return sent.ok ? { emailed: true } : { emailed: false, reason: sent.error };
}
