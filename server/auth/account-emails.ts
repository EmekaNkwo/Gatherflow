import type { SystemEmail } from "@/server/email/transactional";

/**
 * The messages an account's own changes send. Plain text, no tracking: each
 * one is about the reader's own sign-in, so it says what happened, what the
 * link does, and what to do if it was not them.
 */

/** To the new address: proves the person asking can read it. */
export function verifyNewAddressEmail(to: string, url: string): SystemEmail {
  return {
    to,
    subject: "Confirm your new GatherFlow email address",
    text:
      "Hello,\n\n" +
      "Somebody asked to use this address to sign in to GatherFlow. " +
      `If that was you, open this link to confirm it:\n\n${url}\n\n` +
      "Until you do, the account keeps its old address. If it was not you, ignore this message.",
  };
}

/** To the old address, at the same time: a change nobody asked for is noticed. */
export function addressChangeNoticeEmail(to: string, newAddress: string): SystemEmail {
  return {
    to,
    subject: "Your GatherFlow email address is being changed",
    text:
      "Hello,\n\n" +
      `Somebody signed in to your GatherFlow account asked to change its address to ${newAddress}. ` +
      "It only changes once that address is confirmed.\n\n" +
      "If this was not you, change your password now and tell your church administrator.",
  };
}

/** To the current, verified address: it has to approve the move first. */
export function approveAddressChangeEmail(to: string, newAddress: string, url: string): SystemEmail {
  return {
    to,
    subject: "Approve the change to your GatherFlow email address",
    text:
      "Hello,\n\n" +
      `Somebody signed in to your GatherFlow account asked to change its address to ${newAddress}. ` +
      `If that was you, open this link to approve it; we will then ask ${newAddress} to confirm:\n\n${url}\n\n` +
      "If it was not you, do not open the link, and change your password.",
  };
}
