import { describe, expect, it } from "vitest";
import { createTemplates } from "@/data/seed/templates";
import { createSeedContext } from "@/data/seed/context";
import { unwrap } from "@/lib/result";
import { globalSearch } from "@/services/search/global-search";
import { ctx, member, snapshot, visitor } from "@/tests/factories";
import { buildExternalLink, draftMessage, logCommunication } from "./messaging";
import { createTemplate, deleteTemplate } from "./templates";
import { renderTemplate } from "./template-engine";

const templates = createTemplates(createSeedContext(new Date("2026-10-12T09:00:00.000Z")));
const welcome = templates.find((template) => template.category === "visitor_welcome")!;

const base = (people = [visitor()]) => snapshot({ people, templates });

describe("renderTemplate", () => {
  it("fills known placeholders and reports the ones it cannot", () => {
    const rendered = renderTemplate(
      "Hi {{firstName}}, welcome to {{churchName}} on {{serviceDate}}. {{senderName}}",
      {
        person: { firstName: "Tunde", lastName: "Balogun" },
        churchName: "Grace Community Church",
        senderName: "Grace",
      },
    );

    expect(rendered.text).toContain("Hi Tunde, welcome to Grace Community Church");
    expect(rendered.missing).toEqual(["serviceDate"]);
    // Unresolved tokens stay visible so nobody sends a half-written message.
    expect(rendered.text).toContain("{{serviceDate}}");
  });

  it("prefers a preferred name", () => {
    const rendered = renderTemplate("Hello {{firstName}}", {
      person: { firstName: "Samuel", lastName: "Eze", preferredName: "Sam" },
      churchName: "Grace",
      senderName: "Grace",
    });
    expect(rendered.text).toBe("Hello Sam");
  });

  it("flags placeholders it does not understand", () => {
    const rendered = renderTemplate("Hello {{nickname}}", {
      person: { firstName: "Sam", lastName: "Eze" },
      churchName: "Grace",
      senderName: "Grace",
    });
    expect(rendered.unknown).toEqual(["nickname"]);
  });
});

describe("draftMessage", () => {
  it("prepares a message for the preferred channel, with no ready-made link", () => {
    const draft = unwrap(
      draftMessage(base(), { personId: "person_visitor", templateId: welcome.id }, ctx()),
    );

    expect(draft.channel).toBe("whatsapp");
    expect(draft.body).toContain("Tunde");
    expect(draft).not.toHaveProperty("externalLink");
  });

  it("does not count drafts or failed emails towards the contact limit", () => {
    const entry = (index: number, status: "drafted" | "failed" | "copied") => ({
      id: `comm_${index}`,
      personId: "person_visitor",
      channel: "whatsapp" as const,
      status,
      body: "Hello",
      at: "2026-10-10T09:00:00.000Z",
      actorId: "tm_coord_grace",
      simulated: true as const,
    });
    const data = { ...base(), communications: [entry(1, "drafted"), entry(2, "drafted"), entry(3, "failed"), entry(4, "copied")] };

    const draft = unwrap(draftMessage(data, { personId: "person_visitor", templateId: welcome.id }, ctx()));

    expect(draft.recentContactCount).toBe(1);
    expect(draft.limitWarning).toBeUndefined();
  });

  it("refuses to prepare anything for someone who opted out", () => {
    const optedOut = visitor({
      contact: { preferredMethod: "sms", permissionGranted: false, optedOut: true },
    });
    const outcome = draftMessage(
      base([optedOut]),
      { personId: "person_visitor", templateId: welcome.id },
      ctx(),
    );

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("opted_out");
  });

  it("refuses when no contact permission was given", () => {
    const noPermission = visitor({
      contact: { preferredMethod: "sms", permissionGranted: false, optedOut: false },
    });
    const outcome = draftMessage(
      base([noPermission]),
      { personId: "person_visitor", templateId: welcome.id },
      ctx(),
    );

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("no_permission");
  });

  it("warns when the church's contact limit has already been reached", () => {
    const data = {
      ...base(),
      communications: Array.from({ length: 3 }, (_, index) => ({
        id: `comm_${index}`,
        personId: "person_visitor",
        channel: "whatsapp" as const,
        status: "opened_external" as const,
        body: "Hello",
        at: "2026-10-10T09:00:00.000Z",
        actorId: "tm_coord_grace",
        simulated: true as const,
      })),
    };

    const draft = unwrap(
      draftMessage(data, { personId: "person_visitor", templateId: welcome.id }, ctx()),
    );

    expect(draft.recentContactCount).toBe(3);
    expect(draft.limitWarning).toContain("agreed limit is 3");
  });
});

describe("buildExternalLink", () => {
  it("builds channel-appropriate links and nothing when details are missing", () => {
    expect(buildExternalLink("whatsapp", "+44 7700 900111", undefined, "hi")).toContain("wa.me");
    expect(buildExternalLink("sms", "+44 7700 900111", undefined, "hi")).toContain("sms:");
    expect(buildExternalLink("email", undefined, "a@example.com", "hi")).toContain("mailto:");
    expect(buildExternalLink("phone", "+44 7700 900111", undefined, "hi")).toContain("tel:");
    expect(buildExternalLink("in_person", "+44 7700 900111", undefined, "hi")).toBeUndefined();
    expect(buildExternalLink("email", undefined, undefined, "hi")).toBeUndefined();
  });

  it("keeps the whole international number for WhatsApp", () => {
    expect(buildExternalLink("whatsapp", "+44 7700 900506", undefined, "hi")).toBe("https://wa.me/447700900506?text=hi");
    expect(buildExternalLink("whatsapp", "07700 900506", undefined, "hi")).toBe("https://wa.me/447700900506?text=hi");
    expect(buildExternalLink("whatsapp", "0803 123 4567", undefined, "hi", "234")).toBe("https://wa.me/2348031234567?text=hi");
  });

  it("offers no WhatsApp link for a number that can't be dialled", () => {
    expect(buildExternalLink("whatsapp", "ask at the desk", undefined, "hi")).toBeUndefined();
    expect(buildExternalLink("whatsapp", "12345", undefined, "hi")).toBeUndefined();
  });

  it("carries exactly the text it is given, edits included", () => {
    expect(buildExternalLink("email", undefined, "a@example.com", "Edited & final")).toBe(
      "mailto:a@example.com?body=Edited%20%26%20final",
    );
  });
});

describe("logCommunication", () => {
  it("records what happened and marks the entry as simulated", () => {
    const outcome = unwrap(
      logCommunication(
        base(),
        {
          personId: "person_visitor",
          channel: "whatsapp",
          status: "copied",
          body: "Hello Tunde",
          templateId: welcome.id,
        },
        ctx(),
      ),
    );

    const entry = outcome.snapshot.communications[0];
    expect(entry.simulated).toBe(true);
    expect(entry.status).toBe("copied");
    expect(outcome.snapshot.people[0].visitor?.lastContactAt).toBe("2026-10-12T09:00:00.000Z");
  });

  it("does not count a draft as a contact", () => {
    const outcome = unwrap(
      logCommunication(
        base(),
        { personId: "person_visitor", channel: "sms", status: "drafted", body: "Draft" },
        ctx(),
      ),
    );

    expect(outcome.snapshot.people[0].visitor?.lastContactAt).toBeUndefined();
  });

  it("refuses to log a message to someone who opted out", () => {
    const optedOut = visitor({
      contact: { preferredMethod: "sms", permissionGranted: false, optedOut: true },
    });
    const outcome = logCommunication(
      base([optedOut]),
      { personId: "person_visitor", channel: "sms", status: "opened_external", body: "Hi" },
      ctx(),
    );

    expect(outcome.ok).toBe(false);
  });

  it("refuses to log a message to someone who never gave permission", () => {
    const noPermission = visitor({
      contact: { preferredMethod: "sms", permissionGranted: false, optedOut: false },
    });
    const outcome = logCommunication(
      base([noPermission]),
      { personId: "person_visitor", channel: "sms", status: "copied", body: "Hi" },
      ctx(),
    );

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("no_permission");
  });

  it.each([
    ["drafted", "Draft saved"],
    ["copied", "Copied"],
    ["opened_external", "Opened in your messaging app"],
  ] as const)("reads back %s naturally", (status, notice) => {
    const outcome = unwrap(
      logCommunication(base(), { personId: "person_visitor", channel: "sms", status, body: "Hi" }, ctx()),
    );
    expect(outcome.notices).toEqual([notice]);
  });
});

describe("templates", () => {
  it("rejects unknown placeholders", () => {
    const outcome = createTemplate(
      base(),
      {
        name: "Bad template",
        category: "general_check_in",
        channels: ["sms"],
        body: "Hello {{nickname}}",
      },
      ctx(),
    );

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toContain("{{nickname}}");
  });

  it("protects built-in templates from deletion but allows custom ones", () => {
    expect(deleteTemplate(base(), welcome.id).ok).toBe(false);

    const created = unwrap(
      createTemplate(
        base(),
        {
          name: "Our own wording",
          category: "general_check_in",
          channels: ["sms"],
          body: "Hello {{firstName}}",
        },
        // A distinct id factory, so the new template cannot reuse a seeded id.
        ctx({ id: (prefix) => `custom_${prefix}` }),
      ),
    );

    expect(deleteTemplate(created.snapshot, created.templateId).ok).toBe(true);
  });
});

describe("global search scoping", () => {
  const data = snapshot({
    people: [visitor(), member()],
    careRecords: [
      {
        id: "care_1",
        reference: "CARE-001",
        personId: "person_member",
        category: "hospital_visit",
        summary: "Hospital visit requested",
        receivedAt: "2026-10-10",
        status: "assigned",
        notes: [
          {
            at: "2026-10-10T09:00:00.000Z",
            by: "tm_care_joanna",
            text: "Keep the visit short",
            visibility: "restricted",
          },
        ],
        appointments: [],
        createdAt: "2026-10-10T09:00:00.000Z",
        updatedAt: "2026-10-10T09:00:00.000Z",
      },
    ],
  });

  it("finds people for roles that may read the directory", () => {
    const results = globalSearch(data, "Tunde", { role: "follow_up_coordinator" });
    expect(results[0]).toMatchObject({ kind: "visitor", href: "/visitors/person_visitor" });
  });

  it("finds nothing for the member role", () => {
    expect(globalSearch(data, "Tunde", { role: "member" })).toEqual([]);
  });

  it("never returns pastoral-care records or their notes", () => {
    const results = globalSearch(data, "hospital", { role: "pastor" });
    expect(results).toEqual([]);
    const notes = globalSearch(data, "short", { role: "pastor" });
    expect(notes).toEqual([]);
  });

  it("ignores queries that are too short to be meaningful", () => {
    expect(globalSearch(data, "a", { role: "administrator" })).toEqual([]);
  });
});

describe("gapsIn and strayBraces", () => {
  it("lists unfilled placeholders and braces that aren't placeholders", async () => {
    const { gapsIn, strayBraces } = await import("./template-engine");
    expect(gapsIn("our {{groupName}} meets weekly")).toEqual(["{{groupName}}"]);
    expect(strayBraces("Hi {firstName} and {{ first name }}")).toEqual(["{firstName}", "{{ first name }}"]);
    expect(gapsIn("Hi Tunde, see you Sunday")).toEqual([]);
  });
});

describe("summariseHistory", () => {
  const entry = (status: "drafted" | "opened_external" | "sent", channel: "email" | "whatsapp", simulated: boolean) => ({
    id: "c",
    personId: "p",
    channel,
    status,
    body: "",
    at: "2026-10-10T09:00:00.000Z",
    actorId: "tm",
    simulated,
  });

  it("doesn't count a mailto hand-over as emailed, and keeps drafts apart", async () => {
    const { summariseHistory } = await import("./messaging");
    expect(
      summariseHistory([entry("opened_external", "email", true), entry("drafted", "whatsapp", true), entry("sent", "email", false)]),
    ).toBe("2 messages so far, 1 of them emailed by the church. Plus 1 saved draft.");
    expect(summariseHistory([entry("opened_external", "email", true)])).toBe("1 message so far.");
  });
});
