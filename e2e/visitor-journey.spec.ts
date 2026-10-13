import { expect, test } from "@playwright/test";
import { openApp, readCollection, tickByLabel } from "./helpers";

interface StoredPerson {
  id: string;
  firstName: string;
  lastName: string;
  kind: string;
  visitor?: { stageId: string; assignedTo?: string };
  member?: { reference: string };
  groupIds: string[];
}

interface StoredTask {
  id: string;
  personId: string;
  type: string;
  status: string;
  origin: string;
}

/**
 * The journey the product exists for: a first-time visitor is registered,
 * followed up, comes back, and ends up connected — with every step recorded.
 */
test.describe("visitor to member journey", () => {
  test("registers a visitor, follows up, and confirms membership", async ({ page }) => {
    await openApp(page, "/visitors/new");

    await page.fill("#firstName", "Ada");
    await page.fill("#lastName", "Testcase");
    await page.fill("#phone", "+44 7700 900555");
    await tickByLabel(page, "permissionGranted");
    await page.getByRole("button", { name: "Register visitor" }).click();

    // The profile opens, and the first-visit rule has created a welcome task.
    await expect(page.getByRole("heading", { name: "Ada Testcase" })).toBeVisible();
    await expect(page.getByText(/Welcome message · FU-/)).toBeVisible();

    const people = await readCollection<StoredPerson>(page, "people");
    const ada = people.find((person) => person.lastName === "Testcase");
    expect(ada).toBeDefined();

    const tasks = await readCollection<StoredTask>(page, "tasks");
    const welcome = tasks.filter(
      (task) => task.personId === ada!.id && task.type === "welcome_message",
    );
    expect(welcome).toHaveLength(1);
    expect(welcome[0].origin).toBe("rule:first_visit_welcome");

    // Assign the follow-up, which also moves them to "contact pending".
    await page.selectOption('select[aria-label="Assign follow-up"]', { index: 1 });
    await expect(page.getByText("Contact pending")).toBeVisible();

    // Complete the welcome task with a successful outcome.
    await page.getByRole("button", { name: "Complete" }).first().click();
    await expect(page.getByRole("heading", { name: "Record the outcome" })).toBeVisible();
    await page.getByRole("button", { name: "Save outcome" }).click();

    await expect(page.getByText("Contacted", { exact: false }).first()).toBeVisible();

    const afterContact = await readCollection<StoredPerson>(page, "people");
    expect(afterContact.find((person) => person.id === ada!.id)?.visitor?.stageId).toBe(
      "contacted",
    );

    // A successful welcome produces the natural next action.
    const nextTasks = await readCollection<StoredTask>(page, "tasks");
    expect(
      nextTasks.some(
        (task) =>
          task.personId === ada!.id && task.origin === "rule:next_action_suggestion",
      ),
    ).toBe(true);

    // Confirm membership from the same record, keeping the person id.
    await page.getByRole("button", { name: "Register as a member" }).click();
    await expect(page).toHaveURL(new RegExp(`/members/${ada!.id}$`));
    await expect(page.getByText(/Member MEM-\d+/).first()).toBeVisible();

    const asMember = (await readCollection<StoredPerson>(page, "people")).find(
      (person) => person.id === ada!.id,
    );
    expect(asMember?.kind).toBe("member");
    expect(asMember?.visitor).toBeDefined();
  });

  test("records a returning visit and moves the journey on", async ({ page }) => {
    await openApp(page);

    const sessions = await readCollection<{ id: string; date: string }>(page, "sessions");
    const past = sessions.filter((session) => session.date <= new Date().toISOString().slice(0, 10));
    const [first, second] = past.slice(-2);

    await page.goto(`/attendance/${first.id}`);
    await page.getByLabel("Search people to check in").fill("");
    await page.waitForTimeout(300);

    // Register someone new at this service, then check them in to another.
    await openApp(page, "/visitors/new");
    await page.fill("#firstName", "Return");
    await page.fill("#lastName", "Visitor");
    await page.selectOption("#sessionId", first.id);
    await page.getByRole("button", { name: "Register visitor" }).click();
    await expect(page.getByRole("heading", { name: "Return Visitor" })).toBeVisible();

    const people = await readCollection<StoredPerson>(page, "people");
    const person = people.find((entry) => entry.lastName === "Visitor")!;

    await page.goto(`/attendance/${second.id}`);
    await page.getByLabel("Search people to check in").fill("Return Visitor");
    await page.getByRole("button", { name: "Check in" }).first().click();

    await page.goto(`/visitors/${person.id}`);
    await expect(page.getByText("Returned").first()).toBeVisible();
    await expect(page.getByText("2 recorded visits")).toBeVisible();
  });
});
