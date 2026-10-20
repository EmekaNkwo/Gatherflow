import { describe, expect, it } from "vitest";
import { plainStageName } from "./stage-names";

describe("plain stage names", () => {
  it("says the default stages in plain words", () => {
    expect(plainStageName({ id: "contact_pending", name: "Contact pending" })).toBe("Waiting for a hello");
    expect(plainStageName({ id: "closed", name: "Closed" })).toBe("Follow-up stopped");
  });

  it("keeps a name the church chose for itself", () => {
    expect(plainStageName({ id: "contact_pending", name: "Awaiting the welcome team" })).toBe("Awaiting the welcome team");
    expect(plainStageName({ id: "custom_stage", name: "Prayer partner" })).toBe("Prayer partner");
  });
});
