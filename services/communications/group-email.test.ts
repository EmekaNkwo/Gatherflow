import { describe, expect, it } from "vitest";
import { createTemplates } from "@/data/seed/templates";
import { createSeedContext } from "@/data/seed/context";
import { commandFor } from "@/services/commands/registry";
import { ctx, snapshot, visitor } from "@/tests/factories";
import {
  bccBatches,
  buildMailto,
  GROUP_MESSAGE_MAX_PEOPLE,
  hasPersonalPlaceholders,
  logCommunications,
  personalDrafts,
  renderForEveryone,
  sortRecipients,
} from "./group-email";

const templates = createTemplates(createSeedContext(new Date("2026-10-12T09:00:00.000Z")));
const welcome = templates.find((template) => template.category === "visitor_welcome")!;

const amara = visitor({ id: "p_amara", firstName: "Amara", lastName: "Okafor", email: "amara@example.com" });
const tobi = visitor({ id: "p_tobi", firstName: "Tobi", lastName: "Tetteh", email: "tobi@example.com" });
const reuben = visitor({
  id: "p_reuben",
  firstName: "Reuben",
  lastName: "Zulu",
  email: "reuben@example.com",
  contact: { preferredMethod: "email", permissionGranted: true, optedOut: true },
});
const noEmail = visitor({ id: "p_noemail", firstName: "Folake", lastName: "Banda", email: undefined });
const noPermission = visitor({
  id: "p_noperm",
  firstName: "Kofi",
  lastName: "Mensah",
  email: "kofi@example.com",
  contact: { preferredMethod: "email", permissionGranted: false, optedOut: false },
});

const church = snapshot({ people: [amara, tobi, reuben, noEmail, noPermission], templates });

describe("sortRecipients", () => {
  it("keeps people who can be emailed and names everyone left out, with why", () => {
    const sorted = sortRecipients(church, ["p_amara", "p_tobi", "p_reuben", "p_noemail", "p_noperm", "p_gone"]);

    expect(sorted.ready.map((entry) => entry.email)).toEqual(["amara@example.com", "tobi@example.com"]);
    expect(sorted.skipped.map((entry) => [entry.name, entry.reason])).toEqual([
      ["Reuben Zulu", "opted_out"],
      ["Folake Banda", "no_email"],
      ["Kofi Mensah", "no_permission"],
    ]);
  });

  it("lists somebody once even when chosen twice", () => {
    expect(sortRecipients(church, ["p_amara", "p_amara"]).ready).toHaveLength(1);
  });

  it("ignores an address that isn't one", () => {
    const odd = visitor({ id: "p_odd", email: "not an address" });
    const sorted = sortRecipients(snapshot({ people: [odd], templates }), ["p_odd"]);
    expect(sorted.skipped[0]?.reason).toBe("no_email");
  });
});

describe("hasPersonalPlaceholders", () => {
  it("spots wording that names the person", () => {
    expect(hasPersonalPlaceholders("Hello {{firstName}}")).toBe(true);
    expect(hasPersonalPlaceholders("Hi {{ preferredName }}")).toBe(true);
    expect(hasPersonalPlaceholders("See you at {{churchName}}")).toBe(false);
  });
});

describe("renderForEveryone", () => {
  it("greets everyone instead of one name and fills the shared details", () => {
    const rendered = renderForEveryone(church, welcome.body, [amara, tobi], { senderName: "Pastor Ade" });

    expect(rendered.text).toMatch(/^Hello everyone, thank you for worshipping with us/);
    expect(rendered.text).not.toContain("Amara");
    expect(rendered.text).not.toContain("{{firstName}}");
  });

  it("uses a first-visit date only when everyone shares it", () => {
    const same = renderForEveryone(church, "On {{serviceDate}}", [amara, tobi], { senderName: "A" });
    expect(same.missing).toEqual([]);

    const later = visitor({
      id: "p_later",
      visitor: { ...amara.visitor!, firstVisitDate: "2026-10-11" },
    });
    const mixed = renderForEveryone(church, "On {{serviceDate}}", [amara, later], { senderName: "A" });
    expect(mixed.missing).toEqual(["serviceDate"]);
    expect(mixed.text).toBe("On {{serviceDate}}");
  });
});

describe("personalDrafts", () => {
  it("writes each person their own message", () => {
    const drafts = personalDrafts(church, welcome.id, [amara, tobi], ctx());

    expect(drafts.map((draft) => draft.body.split(",")[0])).toEqual(["Hello Amara", "Hello Tobi"]);
    expect(drafts.every((draft) => draft.channel === "email")).toBe(true);
  });
});

describe("buildMailto", () => {
  it("hides recipients in BCC and encodes the subject and body", () => {
    const link = buildMailto({ bcc: ["a@example.com", "b@example.com"], subject: "Hi & welcome", body: "Line one\nLine two" });

    expect(link).toBe("mailto:?bcc=a@example.com,b@example.com&subject=Hi%20%26%20welcome&body=Line%20one%0ALine%20two");
  });

  it("addresses one person directly", () => {
    expect(buildMailto({ to: ["a@example.com"], subject: "", body: "Hi" })).toBe("mailto:a@example.com?body=Hi");
  });
});

describe("bccBatches", () => {
  const emails = Array.from({ length: 60 }, (_, index) => `person${index}@example.com`);

  it("keeps everyone in one email when the link is short enough", () => {
    expect(bccBatches(emails.slice(0, 3), "Hi", "Short")).toEqual([emails.slice(0, 3)]);
  });

  it("splits a long list so every link fits, without losing anyone", () => {
    const batches = bccBatches(emails, "Hello", "A short note.", 600);

    expect(batches!.length).toBeGreaterThan(1);
    expect(batches!.flat()).toEqual(emails);
    for (const batch of batches!) {
      expect(buildMailto({ bcc: batch, subject: "Hello", body: "A short note." }).length).toBeLessThanOrEqual(600);
    }
  });

  it("gives up when the message alone is too long for a link", () => {
    expect(bccBatches(emails, "Hello", "x".repeat(700), 600)).toBeNull();
  });
});

describe("logCommunications", () => {
  it("records one entry per person and says how many", () => {
    const outcome = logCommunications(
      church,
      {
        channel: "email",
        status: "sent_external",
        templateId: welcome.id,
        entries: [
          { personId: "p_amara", body: "Hello everyone" },
          { personId: "p_tobi", body: "Hello everyone" },
        ],
      },
      ctx(),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const logged = outcome.value.snapshot.communications.filter((entry) => entry.status === "sent_external");
    expect(logged.map((entry) => entry.personId)).toEqual(["p_amara", "p_tobi"]);
    expect(logged.every((entry) => entry.simulated)).toBe(true);
    expect(outcome.value.notices[0]).toBe("Recorded 2 emails");
  });

  it("skips anyone who opted out since, and names them", () => {
    const outcome = logCommunications(
      church,
      {
        channel: "email",
        status: "sent_external",
        entries: [
          { personId: "p_amara", body: "Hi" },
          { personId: "p_reuben", body: "Hi" },
        ],
      },
      ctx(),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.snapshot.communications.map((entry) => entry.personId)).toEqual(["p_amara"]);
    expect(outcome.value.notices).toEqual(["Recorded 1 email", "Not recorded for Reuben Zulu: they opted out of contact."]);
  });

  it("refuses when nobody could be recorded", () => {
    const outcome = logCommunications(
      church,
      { channel: "email", status: "sent_external", entries: [{ personId: "p_reuben", body: "Hi" }] },
      ctx(),
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe("opted_out");
  });
});

describe("communication.logMany command", () => {
  const command = commandFor("communication.logMany");
  const entry = { personId: "p_amara", body: "Hi" };

  it("refuses more people than one request may record", () => {
    const tooMany = Array.from({ length: GROUP_MESSAGE_MAX_PEOPLE + 1 }, () => entry);
    expect(command.schema.safeParse({ channel: "email", status: "sent_external", entries: tooMany }).success).toBe(false);
    expect(command.schema.safeParse({ channel: "email", status: "sent_external", entries: [] }).success).toBe(false);
  });

  it("lets a volunteer record only for people they look after", () => {
    const mine = snapshot({ people: [{ ...amara, visitor: { ...amara.visitor!, assignedTo: "tm_me" } }, tobi], templates });
    const input = (personIds: string[]) => ({
      channel: "email" as const,
      status: "sent_external" as const,
      entries: personIds.map((personId) => ({ personId, body: "Hi" })),
    });

    expect(command.ownedBy?.(mine, input(["p_amara"]), "tm_me")).toBe(true);
    expect(command.ownedBy?.(mine, input(["p_amara", "p_tobi"]), "tm_me")).toBe(false);
  });
});
