import { describe, expect, it } from "vitest";
import { auditTarget, describeAction, maskEmail, parseAuditTarget } from "./audit-labels";

describe("audit labels", () => {
  it("reads actions as sentences", () => {
    expect(describeAction("settings.upsertTeamMember")).toBe("Added or changed a team member");
    expect(describeAction("membership.role")).toBe("Changed an account's role");
    expect(describeAction("brand.newThing")).toBe("Brand New Thing");
  });

  it("masks an invitee's address", () => {
    expect(maskEmail(" Jane.Doe@Example.com ")).toBe("j•••@example.com");
    expect(maskEmail("not-an-address")).toBe("•••");
  });

  it("keeps one detail with a target and reads it back", () => {
    const target = auditTarget("j•••@example.com", "volunteer");
    expect(parseAuditTarget(target)).toEqual({ id: "j•••@example.com", detail: "volunteer" });
    expect(parseAuditTarget("tm_vol_tunde")).toEqual({ id: "tm_vol_tunde", detail: null });
    expect(parseAuditTarget(null)).toEqual({ id: null, detail: null });
    expect(auditTarget("tm_vol_tunde")).toBe("tm_vol_tunde");
  });
});
