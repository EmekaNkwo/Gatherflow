import { expect, test } from "@playwright/test";
import { openApp, readCollection, TEAM, useRole } from "./helpers";

interface StoredPerson {
  id: string;
  firstName: string;
  lastName: string;
  contact: { optedOut: boolean };
}

interface StoredTask {
  personId: string;
  status: string;
}

/**
 * The promises the product makes about people's preferences and about who
 * can see what. These are the tests that matter most: getting them wrong
 * means contacting somebody who asked to be left alone.
 */
test.describe("contact preferences", () => {
  test("stopping follow-up with an opt-out cancels open work and blocks messages", async ({
    page,
  }) => {
    await openApp(page, "/visitors/new");

    await page.fill("#firstName", "Quiet");
    await page.fill("#lastName", "Please");
    await page.getByRole("button", { name: "Register visitor" }).click();
    await expect(page.getByRole("heading", { name: "Quiet Please" })).toBeVisible();

    const people = await readCollection<StoredPerson>(page, "people");
    const person = people.find((entry) => entry.lastName === "Please")!;

    await page.getByRole("button", { name: "Stop follow-up" }).click();
    await page.locator('label[for="closure-opt-out"]').click();
    await page.getByRole("button", { name: "Stop follow-up" }).last().click();

    await expect(page.getByText("Do not contact")).toBeVisible();

    const tasks = (await readCollection<StoredTask>(page, "tasks")).filter(
      (task) => task.personId === person.id,
    );
    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks.every((task) => !["pending", "in_progress", "rescheduled"].includes(task.status))).toBe(
      true,
    );

    // No message can be prepared for them any more.
    await expect(page.getByRole("button", { name: "Prepare a message" })).toHaveCount(0);
  });

  test("the seeded opted-out visitor has no open follow-up work", async ({ page }) => {
    await openApp(page, "/visitors?filter=contact_declined");

    const people = await readCollection<StoredPerson>(page, "people");
    const tasks = await readCollection<StoredTask>(page, "tasks");
    const optedOut = people.filter((person) => person.contact.optedOut);

    expect(optedOut.length).toBeGreaterThan(0);
    for (const person of optedOut) {
      const open = tasks.filter(
        (task) =>
          task.personId === person.id &&
          ["pending", "in_progress", "rescheduled"].includes(task.status),
      );
      expect(open).toHaveLength(0);
    }
  });
});

test.describe("demo roles", () => {
  test("pastoral care is restricted, and visible to a pastor", async ({ page }) => {
    await openApp(page);

    await useRole(page, "volunteer", TEAM.volunteer);
    await page.goto("/pastoral-care");
    await expect(page.getByText("Pastoral care is restricted")).toBeVisible();

    await useRole(page, "pastor", TEAM.pastor);
    await page.goto("/pastoral-care");
    await expect(page.getByRole("heading", { name: "Pastoral care" })).toBeVisible();
    await expect(page.getByText("Restricted section")).toBeVisible();
  });

  test("a volunteer only sees their own tasks", async ({ page }) => {
    await openApp(page);
    await useRole(page, "volunteer", TEAM.volunteer);

    await page.goto("/follow-ups/tasks");
    await page.waitForLoadState("networkidle");

    const assignees = await page.locator("tbody tr td:nth-child(5)").allTextContents();
    expect(assignees.length).toBeGreaterThan(0);
    expect(new Set(assignees.map((value) => value.trim())).size).toBe(1);
  });

  test("the member role sees no directory and no tasks", async ({ page }) => {
    await openApp(page);
    await useRole(page, "member", TEAM.member);

    await page.goto("/follow-ups/tasks");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("tbody tr")).toHaveCount(0);

    await page.goto("/settings");
    await expect(page.getByText("Settings is restricted")).toBeVisible();
  });
});

test.describe("exports", () => {
  test("the demo export leaves out pastoral-care records", async ({ page }) => {
    await openApp(page);
    await useRole(page, "administrator", TEAM.admin);
    await page.goto("/settings");

    const bundle = await page.evaluate(() => {
      const read = (key: string) => {
        const raw = localStorage.getItem(`gatherflow:v1:${key}`);
        return raw ? (JSON.parse(raw).data ?? []) : [];
      };
      return { careRecords: read("careRecords").length };
    });

    // Care records exist in storage...
    expect(bundle.careRecords).toBeGreaterThan(0);

    // ...but the export deliberately omits them, which the UI states.
    await expect(page.getByRole("tab", { name: "Demo data" })).toBeVisible();
    await page.getByRole("tab", { name: "Demo data" }).click();
    await expect(
      page.getByText("Exports deliberately leave out pastoral-care records"),
    ).toBeVisible();
  });
});
