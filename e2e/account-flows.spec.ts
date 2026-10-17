import { expect, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { createDatabase, type Database } from "@/server/db/client";
import { churchMembers, churches, people, user } from "@/server/db/schema";
import { REMOTE_E2E } from "../playwright.config";

/**
 * A church from nothing: an account signs up and gets an empty church,
 * registers and follows up its first visitor, invites a volunteer who joins
 * through the link, takes a self-registration from the public welcome page,
 * and recovers a forgotten password through the reset email. Every step is
 * the real path over HTTP; the only stand-in is the mail provider.
 */
let db: Database;
const stamp = Date.now();
const admin = {
  name: "Ruth Founder",
  email: `founder-${stamp}@example.com`,
  password: "a-long-enough-password-1",
};
const volunteer = {
  name: "Amara Helper",
  email: `volunteer-${stamp}@example.com`,
  password: "another-long-password-2",
};
const churchName = `E2E Fellowship ${stamp}`;
let churchId: string;

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ request }) => {
  db = createDatabase({ connectionString: process.env.TEST_DATABASE_URL as string, max: 2 });
  await request.delete(`${REMOTE_E2E.stubURL}/sent`);
});

test.afterAll(async () => {
  if (churchId) await db.delete(churches).where(eq(churches.id, churchId));
  for (const email of [admin.email, volunteer.email]) {
    await db.delete(user).where(eq(user.email, email));
  }
});

async function signIn(page: Page, account: { email: string; password: string }) {
  await page.goto("/sign-in");
  await page.fill("#sign-in-email", account.email);
  await page.fill("#sign-in-password", account.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("/dashboard");
}

async function stubMail(request: APIRequestContext) {
  const response = await request.get(`${REMOTE_E2E.stubURL}/sent`);
  return (await response.json()) as Array<{ message: { To: Array<{ Email: string }>; Subject: string; TextPart: string } }>;
}

test("the landing page offers the two ways in", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("who attended");
  await expect(page.getByRole("link", { name: "Create your church" }).first()).toHaveAttribute("href", "/sign-up");
  await expect(page.getByRole("link", { name: "Sign in" }).first()).toHaveAttribute("href", "/sign-in");
  // The old demo entry points are gone.
  const demo = await page.request.get("/demo");
  expect(demo.status()).toBe(404);
});

test("signing up creates an account and an empty church with the founder as administrator", async ({ page }) => {
  await page.goto("/sign-up");
  await page.fill("#sign-up-church", churchName);
  await page.fill("#sign-up-name", admin.name);
  await page.fill("#sign-up-email", admin.email);
  await page.fill("#sign-up-password", admin.password);
  await page.getByRole("button", { name: "Create church" }).click();
  await page.waitForURL("/dashboard");

  await expect(page.getByText("Welcome to your church")).toBeVisible();
  await expect(page.getByText(churchName).first()).toBeVisible();

  const [account] = await db.select({ id: user.id }).from(user).where(eq(user.email, admin.email));
  const [membership] = await db
    .select({ churchId: churchMembers.churchId, role: churchMembers.role, teamMemberId: churchMembers.teamMemberId })
    .from(churchMembers)
    .where(eq(churchMembers.userId, account.id));
  expect(membership.role).toBe("administrator");
  expect(membership.teamMemberId).not.toBeNull();
  churchId = membership.churchId;

  // Nothing synthetic: the church has exactly the people it was given, none.
  const rows = await db.select({ id: people.id }).from(people).where(eq(people.churchId, churchId));
  expect(rows).toHaveLength(0);
});

test("registers a first visitor, follows up, and confirms membership", async ({ page }) => {
  await signIn(page, admin);

  await page.goto("/visitors/new");
  await page.fill("#firstName", "Ada");
  await page.fill("#lastName", "Testcase");
  await page.fill("#phone", "+44 7700 900555");
  await page.locator('label[for="permissionGranted"]').click();
  await page.getByRole("button", { name: "Add Ada" }).click();

  // The profile opens, and the first-visit rule has created a welcome task
  // for the founder, the only team member there is.
  await expect(page.getByRole("heading", { name: "Ada Testcase" })).toBeVisible();
  await expect(page.getByText("Send a welcome message")).toBeVisible();

  await page.getByLabel("Who's looking after Ada").selectOption({ index: 1 });
  await expect(page.getByText("Waiting for a hello")).toBeVisible();

  await page.getByRole("button", { name: /^Done: record what happened with Ada/ }).click();
  await expect(page.getByRole("heading", { name: "How did it go with Ada?" })).toBeVisible();
  // "We spoke" is chosen already, the way most follow-ups end.
  await expect(page.getByRole("radio", { name: "We spoke" })).toBeChecked();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Contacted", { exact: false }).first()).toBeVisible();

  await page.getByRole("button", { name: "Make them a member" }).click();
  await expect(page).toHaveURL(/\/members\/person_/);
  await expect(page.getByText(/Member MEM-\d+/).first()).toBeVisible();

  const rows = await db.select({ kind: people.kind }).from(people).where(eq(people.churchId, churchId));
  expect(rows).toEqual([{ kind: "member" }]);
});

test("invites a volunteer, who joins through the link and sees only their own work", async ({ page, browser }) => {
  await signIn(page, admin);
  await page.goto("/settings");
  await page.getByRole("tab", { name: "Team" }).click();

  await page.fill("#invite-email", volunteer.email);
  await page.selectOption("#invite-role", "volunteer");
  await page.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByText(`Emailed to ${volunteer.email}.`)).toBeVisible();
  const shown = (await page.locator("code").first().textContent())?.trim();
  expect(shown).toMatch(/\/accept-invite\?token=/);
  await expect(page.getByText(volunteer.email).first()).toBeVisible();

  // The invitation arrived by email, carrying the same link the page showed.
  const invitationMail = (await stubMail(page.request)).find((entry) =>
    entry.message.To.some((to) => to.Email === volunteer.email),
  );
  expect(invitationMail?.message.Subject).toBe(`You're invited to join ${churchName} on GatherFlow`);
  const link = invitationMail?.message.TextPart.match(/https?:\/\/\S+\/accept-invite\?token=\S+/)?.[0];
  expect(link).toBe(shown);

  // A forged token is refused before anybody signs in.
  const forged = await page.request.get(`/api/invitations/not-a-real-token`);
  expect(forged.status()).toBe(404);

  // The volunteer, on their own browser.
  const theirs = await newVisitor(browser, link as string);
  await theirs.fill("#invite-name", volunteer.name);
  await theirs.fill("#invite-password", volunteer.password);
  await theirs.getByRole("button", { name: "Create account and join" }).click();
  await theirs.waitForURL("/dashboard");
  await expect(theirs.getByText(churchName).first()).toBeVisible();
  // Today greets them by name and tells them, in words, what is waiting.
  await expect(theirs.getByRole("heading", { name: /^Good (morning|afternoon|evening), Amara$/ })).toBeVisible();
  await expect(theirs.getByText("Nothing is waiting for you today.")).toBeVisible();
  // No Settings for a volunteer; the server would refuse it anyway.
  await expect(theirs.getByRole("link", { name: "Settings" })).toHaveCount(0);
  const refused = await theirs.request.get("/api/church/members");
  expect(refused.status()).toBe(403);
  await theirs.context().close();

  // The administrator now sees the account, and can change its role.
  await page.reload();
  await page.getByRole("tab", { name: "Team" }).click();
  await expect(page.getByText(volunteer.email).first()).toBeVisible();
  await page.getByLabel(`Role for ${volunteer.email}`).selectOption("follow_up_coordinator");
  await expect(page.getByText(/is now follow-up coordinator/)).toBeVisible();

  const [account] = await db.select({ id: user.id }).from(user).where(eq(user.email, volunteer.email));
  const [membership] = await db
    .select({ role: churchMembers.role })
    .from(churchMembers)
    .where(eq(churchMembers.userId, account.id));
  expect(membership.role).toBe("follow_up_coordinator");

  // And the audit trail says so.
  await page.getByRole("tab", { name: "Audit" }).click();
  await expect(page.getByText("invitation.create")).toBeVisible();
  await expect(page.getByText("membership.role")).toBeVisible();
});

test("a visitor registers themselves from the public welcome page", async ({ page, browser }) => {
  const visitor = await newVisitor(browser, `/connect/${churchId}`);
  await expect(visitor.getByText(`Welcome to ${churchName}`, { exact: true })).toBeVisible();
  await visitor.fill("#connect-firstName", "Walk");
  await visitor.fill("#connect-lastName", "In");
  await visitor.fill("#connect-email", "walk.in@example.com");
  await visitor.locator('label[for="connect-permission"]').click();
  await visitor.getByRole("button", { name: "Submit" }).click();
  await expect(visitor.getByText("Thank you", { exact: true })).toBeVisible();

  // The page gives nothing away about a church that does not exist.
  await visitor.goto("/connect/no-such-church");
  await expect(visitor.getByText("This link is not valid", { exact: true })).toBeVisible();
  await visitor.context().close();

  await signIn(page, admin);
  await page.goto("/visitors");
  await expect(page.getByText("Walk In").first()).toBeVisible();
});

test("recovers a forgotten password through the reset email", async ({ page, request }) => {
  await request.delete(`${REMOTE_E2E.stubURL}/sent`);
  await page.goto("/forgot-password");
  await page.fill("#forgot-email", admin.email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByText("a reset link is on its way")).toBeVisible();

  // The same answer for an address nobody has, so the page reveals nothing.
  await page.goto("/forgot-password");
  await page.fill("#forgot-email", `nobody-${stamp}@example.com`);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByText("a reset link is on its way")).toBeVisible();

  const mail = await stubMail(request);
  const reset = mail.find((entry) => entry.message.To[0].Email === admin.email);
  expect(reset, "a reset email reached the provider").toBeDefined();
  expect(mail.some((entry) => entry.message.To[0].Email.startsWith("nobody-"))).toBe(false);
  const url = reset!.message.TextPart.match(/https?:\/\/\S+/)?.[0];
  expect(url).toBeDefined();

  const newPassword = "a-brand-new-password-3";
  await page.goto(url as string);
  await page.waitForURL(/\/reset-password\?token=/);
  await page.fill("#reset-password", newPassword);
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByText("Your password has been changed")).toBeVisible();

  await signIn(page, { email: admin.email, password: newPassword });
  await expect(page.getByText(churchName).first()).toBeVisible();
  admin.password = newPassword;
});

test("a person manages their own account: address, reminders and leaving", async ({ page, request }) => {
  await request.delete(`${REMOTE_E2E.stubURL}/sent`);
  await signIn(page, volunteer);
  // Reachable from any role, not only from an administrator's settings.
  await page.getByRole("link", { name: "Your account" }).first().click();
  await page.waitForURL("/account");
  // This deployment has no VAPID keys, and the page says so plainly.
  await expect(page.getByText("Reminders are not set up on this deployment yet.")).toBeVisible();

  // Moving to a new address: nothing changes until the new inbox confirms.
  const oldEmail = volunteer.email;
  const newEmail = `volunteer-moved-${stamp}@example.com`;
  await page.fill("#account-new-email", newEmail);
  await page.fill("#account-email-password", "not-the-password");
  await page.getByRole("button", { name: "Change address" }).click();
  await expect(page.getByText("That password is not correct.")).toBeVisible();
  await page.fill("#account-email-password", volunteer.password);
  await page.getByRole("button", { name: "Change address" }).click();
  await expect(page.getByText(`Check ${newEmail} for a link`)).toBeVisible();

  const mail = await stubMail(request);
  const notice = mail.find((entry) => entry.message.To[0].Email === oldEmail);
  expect(notice?.message.Subject).toBe("Your GatherFlow email address is being changed");
  const confirmation = mail.find((entry) => entry.message.To[0].Email === newEmail);
  const url = confirmation?.message.TextPart.match(/https?:\/\/\S+verify-email\S*/)?.[0];
  expect(url, "a confirmation link reached the new address").toBeDefined();
  await page.goto(url as string);
  await page.waitForURL(/\/account\?account=email-confirmed/);
  await expect(page.getByText("Your email address has been changed.")).toBeVisible();
  volunteer.email = newEmail;
  const [moved] = await db.select({ email: user.email }).from(user).where(eq(user.email, newEmail));
  expect(moved).toBeDefined();

  // Leaving: the account goes, the church keeps its record of their work.
  await page.fill("#account-delete-password", volunteer.password);
  await page.getByRole("button", { name: "Delete account" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete account" }).click();
  await page.waitForURL("/");
  expect(await db.select().from(user).where(eq(user.email, newEmail))).toEqual([]);

  // The founder is the church's only administrator, so cannot leave it stranded.
  await signIn(page, admin);
  await page.goto("/account");
  await page.fill("#account-delete-password", admin.password);
  await page.getByRole("button", { name: "Delete account" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete account" }).click();
  await expect(page.getByText(`You are the only administrator of ${churchName}.`, { exact: false })).toBeVisible();
  const [still] = await db.select({ id: user.id }).from(user).where(eq(user.email, admin.email));
  expect(still).toBeDefined();
});

test("on a phone, the app is a tab bar and a menu", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const phone = await context.newPage();
  await signIn(phone, admin);

  const tabs = phone.getByRole("navigation", { name: "Main" });
  await expect(tabs.getByRole("link", { name: "Today" })).toHaveAttribute("aria-current", "page");
  await tabs.getByRole("link", { name: "Welcome" }).click();
  await phone.waitForURL("/visitors/quick");
  await expect(phone.getByRole("heading", { name: "Welcome someone new" })).toBeVisible();

  // Everything else is behind Menu, including what only staff need.
  await tabs.getByRole("button", { name: "Menu" }).click();
  await expect(phone.getByRole("link", { name: "Settings" })).toBeVisible();
  await context.close();
});

async function newVisitor(browser: Browser, path: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(path);
  return page;
}
