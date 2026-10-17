// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { err, ok } from "@/lib/result";
import { composeInvitationEmail, sendInvitationEmail } from "./invitation-email";

const INPUT = {
  to: "volunteer@example.com",
  churchName: "Grace Fellowship",
  inviterName: "Ada Pastor",
  role: "volunteer" as const,
  link: "https://app.example.com/accept-invite?token=abc",
  expiresAt: "2026-10-22T09:00:00.000Z",
};

describe("invitation email", () => {
  it("names the church, the inviter, the role and the link", () => {
    const email = composeInvitationEmail(INPUT);
    expect(email.to).toBe("volunteer@example.com");
    expect(email.subject).toBe("You're invited to join Grace Fellowship on GatherFlow");
    expect(email.text).toContain("Ada Pastor");
    expect(email.text).toMatch(/as volunteer\./);
    expect(email.text).toContain(INPUT.link);
    expect(email.text).toContain("22 Oct 2026");
  });

  it("does not name an inviter it does not know", () => {
    const email = composeInvitationEmail({ ...INPUT, inviterName: "  " });
    expect(email.text).toContain("You have been invited");
    expect(email.text).not.toContain("  has invited");
  });

  it("reports a send that went out", async () => {
    const send = vi.fn().mockResolvedValue(ok(undefined));
    const outcome = await sendInvitationEmail(INPUT, send);
    expect(outcome).toEqual({ emailed: true });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: INPUT.to }));
  });

  it("reports a refused send without throwing, so the link can still be copied", async () => {
    const send = vi.fn().mockResolvedValue(err("This deployment cannot send email yet.", "not_configured"));
    const outcome = await sendInvitationEmail(INPUT, send);
    expect(outcome).toEqual({ emailed: false, reason: "This deployment cannot send email yet." });
  });
});
