import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { createDatabase, type Database } from "@/server/db/client";
import { churchMembers, churches, messageOutbox, user } from "@/server/db/schema";
import { eq as equals } from "drizzle-orm";
import { createPostgresSnapshotRepository } from "@/server/db/snapshot-repository";
import { createSeedSnapshot } from "@/data/seed";
import { REMOTE_E2E } from "../playwright.config";
import { choose, optionNames } from "./select";

/**
 * The whole email path, over HTTP, in the server-backed mode.
 *
 * A coordinator signs in, queues a welcome email from the composer, the cron
 * drains it to the (stub) provider, the provider's events come back through
 * the webhook, and the person unsubscribes through the link every message
 * carries. Each step is asserted where it leaves evidence: the interface,
 * the database, or the provider's record of what it received.
 */

interface StubMessage {
  messageId: number;
  messageUuid: string;
  message: {
    To: Array<{ Email: string }>;
    Subject: string;
    TextPart: string;
    CustomID: string;
    Headers: Record<string, string>;
  };
}

let db: Database;
const churchId = `e2e-remote-church-${Date.now()}`;
const secondChurchId = `${churchId}-second`;
const account = {
  email: `coordinator-${Date.now()}@example.com`,
  password: "correct-horse-battery-staple",
  name: "E2E Coordinator",
};
let personId: string;
let personEmail: string;

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ request }) => {
  db = createDatabase({ connectionString: process.env.TEST_DATABASE_URL as string, max: 2 });

  // The church, seeded exactly as a first load would seed it.
  const repository = createPostgresSnapshotRepository({
    db,
    churchId,
    createSeed: () => createSeedSnapshot(new Date()),
  });
  const loaded = await repository.load();

  const person = loaded.snapshot.people.find(
    (candidate) =>
      candidate.kind === "visitor" &&
      candidate.contact.permissionGranted &&
      !candidate.contact.optedOut &&
      Boolean(candidate.email),
  );
  if (!person?.email) throw new Error("the seed has no contactable visitor with an email");
  personId = person.id;
  personEmail = person.email.toLowerCase();

  // The account, through the real sign-up endpoint; the membership, directly
  // — there is no self-service way to join a church, by design.
  const signUp = await request.post("/api/auth/sign-up/email", { data: account });
  expect(signUp.ok(), await signUp.text()).toBe(true);

  const [created] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, account.email));
  await db.insert(churchMembers).values({
    churchId,
    userId: created.id,
    // An administrator: sends email and reads the audit trail later on.
    role: "administrator",
    teamMemberId: loaded.snapshot.team[0]?.id ?? null,
  });

  await request.delete(`${REMOTE_E2E.stubURL}/sent`);
});

test.afterAll(async () => {
  await db.delete(churches).where(eq(churches.id, churchId));
  await db.delete(churches).where(equals(churches.id, secondChurchId));
  await db.delete(user).where(eq(user.email, account.email));
});

async function signIn(page: Page): Promise<void> {
  await page.goto("/sign-in");
  await page.fill("#sign-in-email", account.email);
  await page.fill("#sign-in-password", account.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("/dashboard");
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
}

async function stubMessages(request: APIRequestContext): Promise<StubMessage[]> {
  const response = await request.get(`${REMOTE_E2E.stubURL}/sent`);
  return (await response.json()) as StubMessage[];
}

async function postWebhook(request: APIRequestContext, events: unknown[]) {
  const response = await request.post(`/api/webhooks/mailjet/${REMOTE_E2E.webhookSecret}`, {
    data: events,
  });
  expect(response.status()).toBe(200);
  return (await response.json()) as { data: Record<string, number> };
}

test("sends the person to sign in, and refuses the API without a session", async ({
  page,
  request,
}) => {
  await page.goto("/dashboard");
  await page.waitForURL("/sign-in");

  const anonymous = await request.get("/api/church");
  expect(anonymous.status()).toBe(401);

  const probe = await request.post("/api/church/email", {
    data: { personId, templateId: "anything" },
  });
  expect(probe.status()).toBe(401);
});

test("queues an email from the composer and the worker hands it to the provider", async ({
  page,
  request,
}) => {
  await signIn(page);

  await page.goto(`/visitors/${personId}`);
  await page.getByRole("button", { name: /^Write a message to / }).click();
  await expect(page.getByRole("heading", { name: /^Write to / })).toBeVisible();

  const dialog = page.getByRole("dialog");

  // Templates are listed alphabetically and not all of them suit email;
  // pick the first one that does, as a person would.
  const template = page.locator("#composer-template");
  const channel = page.locator("#composer-channel");
  for (const name of await optionNames(page, template)) {
    await choose(page, template, name);
    if ((await optionNames(page, channel)).includes("Email")) break;
  }
  await choose(page, channel, "Email");
  // The real thing is on offer: no "Simulated" badge anywhere in the dialog.
  await expect(dialog.getByText("Simulated", { exact: true })).toHaveCount(0);
  await page.fill("#composer-subject", "Lovely to meet you on Sunday");
  await page.fill("#composer-body", "Hello from the welcome team.\n\nSee you next week.");
  await page.getByRole("button", { name: "Send email" }).click();

  await expect(page.getByText("Email queued", { exact: true })).toBeVisible();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Queued to send")).toBeVisible();

  // Nothing has reached the provider yet: the request only queued it.
  expect(await stubMessages(request)).toHaveLength(0);
  const [queued] = await db
    .select()
    .from(messageOutbox)
    .where(eq(messageOutbox.churchId, churchId));
  expect(queued.status).toBe("pending");
  expect(queued.toEmail).toBe(personEmail);

  // The cron pass, exactly as a scheduler would call it.
  const unauthorised = await request.post("/api/cron/drain-outbox");
  expect(unauthorised.status()).toBe(404);

  const drained = await request.post("/api/cron/drain-outbox", {
    headers: { authorization: `Bearer ${REMOTE_E2E.cronSecret}` },
  });
  expect(drained.status()).toBe(200);
  expect((await drained.json()).data).toMatchObject({ claimed: 1, sent: 1, failed: 0 });

  const [sent] = await stubMessages(request);
  expect(sent.message.To[0].Email).toBe(personEmail);
  expect(sent.message.Subject).toBe("Lovely to meet you on Sunday");
  expect(sent.message.TextPart).toContain("Hello from the welcome team.");
  expect(sent.message.CustomID).toBe(`${churchId}:${queued.id}`);
  expect(sent.message.Headers["List-Unsubscribe"]).toMatch(/^<http:\/\/localhost:\d+\/unsubscribe\?/);
  expect(sent.message.Headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");

  await page.reload();
  await expect(page.getByText("Sent to the provider")).toBeVisible();
});

test("applies the provider's delivery report, and ignores a replay of it", async ({
  page,
  request,
}) => {
  const [sent] = await stubMessages(request);
  const event = {
    event: "sent",
    time: Math.floor(Date.now() / 1000),
    MessageID: sent.messageId,
    Message_GUID: sent.messageUuid,
    email: personEmail,
    mj_campaign_id: 0,
    mj_contact_id: 0,
    customcampaign: "",
    smtp_reply: "sent (250 2.0.0 OK)",
    CustomID: sent.message.CustomID,
    Payload: "",
  };

  const first = await postWebhook(request, [event]);
  expect(first.data).toMatchObject({ applied: 1, duplicates: 0 });

  const replay = await postWebhook(request, [event]);
  expect(replay.data).toMatchObject({ applied: 0, duplicates: 1 });

  const wrongSecret = await request.post("/api/webhooks/mailjet/not-the-secret", {
    data: [event],
  });
  expect(wrongSecret.status()).toBe(404);

  await signIn(page);
  await page.goto(`/visitors/${personId}`);
  await expect(page.getByText("Delivered to their mail server")).toBeVisible();

  const health = await request.get("/api/email/health", {
    headers: { authorization: `Bearer ${REMOTE_E2E.cronSecret}` },
  });
  expect(health.status()).toBe(200);
  expect((await health.json()).data.lastWebhookAt).not.toBeNull();
});

test("unsubscribes through the link in the message, and refuses a forged one", async ({
  page,
  request,
}) => {
  const [sent] = await stubMessages(request);
  const link = sent.message.Headers["List-Unsubscribe"].slice(1, -1);

  // A forged link: the right person, the wrong signature.
  const forged = new URL(link);
  forged.searchParams.set("token", "0".repeat(32));
  const refused = await request.get(forged.toString());
  expect(refused.status()).toBe(400);

  // Following the real link shows a confirmation, and changes nothing yet.
  await page.goto(link);
  await expect(page.getByRole("heading", { name: "Stop receiving emails?" })).toBeVisible();

  // One-click unsubscribe from a mail client is a POST with no page involved.
  const oneClick = await request.post(link, {
    form: { "List-Unsubscribe": "One-Click" },
  });
  expect(oneClick.status()).toBe(200);
  expect(await oneClick.text()).toContain("You have been unsubscribed");

  await signIn(page);
  await page.goto(`/visitors/${personId}`);
  await expect(page.getByText("Do not contact")).toBeVisible();
  // And the composer is no longer offered for them.
  await expect(page.getByRole("button", { name: /Write a message/ })).toHaveCount(0);

  // The server refuses too, whatever the interface shows.
  const blocked = await request.post("/api/church/email", {
    data: { personId, templateId: "anything" },
  });
  expect([401, 422]).toContain(blocked.status());
});

test("asks which church to open once the account belongs to two, and keeps an audit trail", async ({
  page,
}) => {
  // A second church, and a membership in it.
  const second = createPostgresSnapshotRepository({
    db,
    churchId: secondChurchId,
    createSeed: () => createSeedSnapshot(new Date()),
  });
  await second.load();
  await db.update(churches).set({ name: "Second Church" }).where(equals(churches.id, secondChurchId));
  const [created] = await db.select({ id: user.id }).from(user).where(eq(user.email, account.email));
  await db.insert(churchMembers).values({
    churchId: secondChurchId,
    userId: created.id,
    role: "pastor",
    teamMemberId: null,
  });

  await page.goto("/sign-in");
  await page.fill("#sign-in-email", account.email);
  await page.fill("#sign-in-password", account.password);
  await page.getByRole("button", { name: "Sign in" }).click();

  // Two churches, no choice yet: the app asks rather than guessing.
  await page.waitForURL("/choose-church");
  await expect(page.getByRole("heading", { name: "Which church?" })).toBeVisible();
  await page.getByRole("button", { name: /Second Church/ }).click();
  await page.waitForURL("/dashboard");
  await expect(page.getByRole("link", { name: "Switch church" })).toBeVisible();

  // Nothing from the first church leaks: this person only exists there.
  await page.goto(`/visitors/${personId}`);
  await expect(page.getByRole("button", { name: /Write a message/ })).toHaveCount(0);

  // Switch back and read the trail of what happened earlier in this suite.
  await page.goto("/choose-church");
  await page.getByRole("button", { name: /^(?!Second Church)/ }).first().click();
  await page.waitForURL("/dashboard");
  await page.goto("/settings");
  await page.getByRole("tab", { name: "Audit" }).click();
  // The trail reads in words, not action codes.
  await expect(page.getByText("Sent an email").first()).toBeVisible();
  await expect(page.getByText("Someone unsubscribed by link").first()).toBeVisible();
});
