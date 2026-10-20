import { describe, expect, it } from "vitest";
import { unwrap } from "@/lib/result";
import { ctx, NOW, snapshot } from "@/tests/factories";
import type { MessageTemplate } from "@/types/communication";
import {
  createTemplate,
  deleteTemplate,
  templatesForChannel,
  updateTemplate,
  type TemplateInput,
} from "./templates";

const NOW_ISO = NOW.toISOString();

function template(overrides: Partial<MessageTemplate> = {}): MessageTemplate {
  return {
    id: "tpl_welcome",
    name: "Welcome",
    category: "visitor_welcome",
    channels: ["whatsapp", "sms"],
    body: "Hi {{firstName}}, welcome to {{churchName}}!",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    builtIn: true,
    ...overrides,
  };
}

const input = (overrides: Partial<TemplateInput> = {}): TemplateInput => ({
  name: " Thank you ",
  category: "thank_you",
  channels: ["email"],
  body: "  Thanks for coming, {{ preferredName }}.  ",
  ...overrides,
});

describe("createTemplate", () => {
  it("creates a custom template with trimmed text", () => {
    const before = snapshot({ templates: [template()] });
    const outcome = unwrap(createTemplate(before, input(), ctx()));
    expect(outcome.templateId).toBe("template_1");
    expect(outcome.snapshot.templates[1]).toEqual({
      id: "template_1",
      name: "Thank you",
      category: "thank_you",
      channels: ["email"],
      body: "Thanks for coming, {{ preferredName }}.",
      createdAt: NOW_ISO,
      updatedAt: NOW_ISO,
      builtIn: false,
    });
    expect(outcome.notices).toEqual(["Thank you created."]);
    expect(before.templates).toHaveLength(1);
  });

  it.each([
    ["a blank name", { name: "  " }, "Give the template a name."],
    ["a blank body", { body: "\n " }, "Write the message body."],
    ["no channels", { channels: [] }, "Choose at least one channel."],
    ["one unknown placeholder", { body: "Hi {{nickname}}" }, "Unknown placeholder: {{nickname}}."],
    [
      "several unknown placeholders, each listed once",
      { body: "{{nickname}} {{ city }} {{nickname}} {{firstName}}" },
      "Unknown placeholders: {{nickname}}, {{city}}.",
    ],
  ])("refuses %s", (_label, override, error) => {
    const outcome = createTemplate(snapshot(), input(override), ctx());
    expect(outcome).toEqual({ ok: false, error, code: "invalid" });
  });
});

describe("updateTemplate", () => {
  it("rewrites a built-in template, keeping its id, creation time and protection", () => {
    const before = snapshot({ templates: [template()] });
    const outcome = unwrap(updateTemplate(before, "tpl_welcome", input(), ctx()));
    expect(outcome.snapshot.templates[0]).toEqual({
      id: "tpl_welcome",
      name: "Thank you",
      category: "thank_you",
      channels: ["email"],
      body: "Thanks for coming, {{ preferredName }}.",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: NOW_ISO,
      builtIn: true,
    });
    expect(outcome.notices).toEqual(["Thank you saved."]);
    expect(before.templates[0].name).toBe("Welcome");
  });

  it("refuses an unknown template before validating", () => {
    expect(updateTemplate(snapshot(), "tpl_gone", input({ name: "" }), ctx())).toMatchObject({
      ok: false,
      code: "not_found",
    });
  });

  it("refuses invalid input", () => {
    expect(updateTemplate(snapshot({ templates: [template()] }), "tpl_welcome", input({ body: "{{oops}}" }), ctx())).toEqual({
      ok: false,
      error: "Unknown placeholder: {{oops}}.",
      code: "invalid",
    });
  });
});

describe("deleteTemplate", () => {
  it("removes a custom template", () => {
    const custom = template({ id: "tpl_custom", name: "Custom", builtIn: false });
    const outcome = unwrap(deleteTemplate(snapshot({ templates: [template(), custom] }), "tpl_custom"));
    expect(outcome.snapshot.templates.map((entry) => entry.id)).toEqual(["tpl_welcome"]);
    expect(outcome.notices).toEqual(["Custom deleted."]);
  });

  it.each([
    ["a built-in template", "tpl_welcome", "protected"],
    ["an unknown template", "tpl_gone", "not_found"],
  ])("refuses %s", (_label, id, code) => {
    expect(deleteTemplate(snapshot({ templates: [template()] }), id)).toMatchObject({ ok: false, code });
  });
});

describe("templatesForChannel", () => {
  const data = snapshot({
    templates: [
      template({ id: "a", channels: ["sms"] }),
      template({ id: "b", channels: ["email", "sms"] }),
      template({ id: "c", channels: ["email"] }),
    ],
  });

  it.each([
    ["sms", ["a", "b"]],
    ["email", ["b", "c"]],
    ["phone", []],
  ] as const)("lists templates suited to %s", (channel, expected) => {
    expect(templatesForChannel(data, channel).map((entry) => entry.id)).toEqual(expected);
  });
});

describe("placeholder mistakes", () => {
  it.each(["Hi {{first-name}}", "Hi {firstName}", "Hi {{ first name }}", "Hi firstName}}"])(
    "refuses %s before it can go out as typed",
    (body) => {
      const outcome = createTemplate(snapshot({ templates: [] }), input({ body }), ctx());
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.code).toBe("invalid");
        expect(outcome.error).toMatch(/placeholder/);
      }
    },
  );

  it("suggests the right capitals for {{firstname}}", () => {
    const outcome = createTemplate(snapshot({ templates: [] }), input({ body: "Hi {{firstname}}" }), ctx());
    expect(outcome.ok ? "" : outcome.error).toContain("Did you mean {{firstName}}?");
  });

  it("still accepts spaced but valid placeholders", () => {
    expect(createTemplate(snapshot({ templates: [] }), input({ body: "Hi {{ firstName }}" }), ctx()).ok).toBe(true);
  });
});
