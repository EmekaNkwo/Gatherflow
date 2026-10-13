import { expect, test } from "@playwright/test";
import { openApp, readCollection, TEAM, useRole } from "./helpers";

interface StoredPerson {
  id: string;
  lastName: string;
}

/**
 * Everything lives in the browser, so the promises about persistence and
 * recovery are the ones a reviewer is most likely to poke at.
 */
test.describe("persistence", () => {
  test("records survive a reload", async ({ page }) => {
    await openApp(page, "/visitors/new");

    await page.fill("#firstName", "Persisted");
    await page.fill("#lastName", "Record");
    await page.getByRole("button", { name: "Register visitor" }).click();
    await expect(page.getByRole("heading", { name: "Persisted Record" })).toBeVisible();

    await page.reload();
    await expect(page.getByRole("heading", { name: "Persisted Record" })).toBeVisible();

    await page.goto("/visitors");
    await page.getByLabel("Search visitors").fill("Persisted");
    await expect(page.getByRole("link", { name: /Persisted Record/ }).first()).toBeVisible();
  });

  test("invalid stored records are dropped instead of breaking the app", async ({ page }) => {
    await openApp(page);

    await page.evaluate(() => {
      const key = "gatherflow:v1:people";
      const envelope = JSON.parse(localStorage.getItem(key)!);
      envelope.data = [...envelope.data.slice(0, 5), { id: "broken" }, { nonsense: true }];
      localStorage.setItem(key, JSON.stringify(envelope));
    });

    await page.reload();
    await expect(page.getByText("Some stored records could not be read")).toBeVisible();
    await expect(page.getByRole("heading", { name: /overview/ })).toBeVisible();

    // The broken rows are dropped and the cleaned data is written back, so
    // the warning does not follow the user around forever.
    const people = await readCollection<StoredPerson>(page, "people");
    expect(people).toHaveLength(5);
  });

  test("restoring the demo data brings back the original church", async ({ page }) => {
    await openApp(page, "/visitors/new");

    await page.fill("#firstName", "Temporary");
    await page.fill("#lastName", "Person");
    await page.getByRole("button", { name: "Register visitor" }).click();
    await expect(page.getByRole("heading", { name: "Temporary Person" })).toBeVisible();

    await useRole(page, "administrator", TEAM.admin);
    await page.goto("/settings");
    await page.getByRole("tab", { name: "Demo data" }).click();
    await page.getByRole("button", { name: "Restore the original demo data" }).click();
    await page.getByRole("button", { name: "Restore demo data" }).click();

    await page.waitForTimeout(500);
    const people = await readCollection<StoredPerson>(page, "people");
    expect(people.some((person) => person.lastName === "Person")).toBe(false);
    expect(people.length).toBeGreaterThan(50);
  });
});

test.describe("the public welcome page", () => {
  test("registers a visitor without exposing any church records", async ({ page }) => {
    await openApp(page, "/connect");

    // Nothing from the operations dashboard is present.
    await expect(page.getByRole("link", { name: "Dashboard" })).toHaveCount(0);
    await expect(page.getByText("Search people, tasks…")).toHaveCount(0);

    await page.fill("#connect-firstName", "Self");
    await page.fill("#connect-lastName", "Registered");
    await page.getByRole("button", { name: "Submit" }).click();

    await expect(page.getByText("Thank you")).toBeVisible();

    const people = await readCollection<{ lastName: string; contact: { permissionGranted: boolean } }>(
      page,
      "people",
    );
    const created = people.find((person) => person.lastName === "Registered");
    expect(created).toBeDefined();
    // Consent is opt-in: leaving the box unticked means no permission.
    expect(created?.contact.permissionGranted).toBe(false);
  });
});

test.describe("responsive layout", () => {
  test("the dashboard works on a narrow screen", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openApp(page);

    await expect(page.getByRole("heading", { name: /overview/ })).toBeVisible();

    // The page itself must not scroll sideways.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
