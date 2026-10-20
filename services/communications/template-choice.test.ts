import { describe, expect, it } from "vitest";
import { createSeedContext } from "@/data/seed/context";
import { createTemplates } from "@/data/seed/templates";
import { channelFor, chooseTemplate } from "./template-choice";

const templates = createTemplates(createSeedContext(new Date("2026-10-12T09:00:00.000Z")));

describe("chooseTemplate", () => {
  it("never opens on the connect-group invitation by default", () => {
    const chosen = chooseTemplate(templates, { preferredMethod: "whatsapp" });
    expect(chosen?.category).toBe("general_check_in");
  });

  it("opens a visitor on the welcome", () => {
    expect(chooseTemplate(templates, { preferredMethod: "sms", isVisitor: true })?.category).toBe("visitor_welcome");
  });

  it("follows the task's kind", () => {
    expect(chooseTemplate(templates, { preferredMethod: "whatsapp", taskType: "group_invitation" })?.category).toBe(
      "group_invitation",
    );
    expect(chooseTemplate(templates, { preferredMethod: "email", taskType: "phone_call" })?.category).toBe(
      "general_check_in",
    );
  });

  it("returns nothing when there are no templates", () => {
    expect(chooseTemplate([], { preferredMethod: "sms" })).toBeUndefined();
  });
});

describe("channelFor", () => {
  it("keeps the preference when the template offers it", () => {
    expect(channelFor({ channels: ["sms", "email"] }, "email")).toBe("email");
  });

  it("falls back to the template's first channel otherwise", () => {
    expect(channelFor({ channels: ["whatsapp", "sms"] }, "email")).toBe("whatsapp");
  });

  it("keeps the current choice while the template still offers it", () => {
    expect(channelFor({ channels: ["whatsapp", "sms"] }, "whatsapp", "sms")).toBe("sms");
    expect(channelFor({ channels: ["whatsapp"] }, "email", "sms")).toBe("whatsapp");
  });
});
