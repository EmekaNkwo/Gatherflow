import type { Page } from "@playwright/test";

/** Team member ids from the seed, used to switch the demo role directly. */
export const TEAM = {
  admin: "tm_admin_ruth",
  pastor: "tm_pastor_daniel",
  coordinator: "tm_coord_grace",
  volunteer: "tm_vol_amara",
  member: "tm_member_samuel",
} as const;

export type DemoRole =
  | "administrator"
  | "pastor"
  | "follow_up_coordinator"
  | "volunteer"
  | "member";

/**
 * Opens the app and waits for the seeded data to be in place.
 *
 * The first load of an empty browser generates the demo church, so every
 * test starts from the same synthetic records.
 */
export async function openApp(page: Page, path = "/"): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => Boolean(localStorage.getItem("gatherflow:v1:people")), {
    timeout: 30_000,
  });
  await page.waitForLoadState("networkidle");
}

/** Switches the demo role without going through the header menu. */
export async function useRole(page: Page, role: DemoRole, teamMemberId: string): Promise<void> {
  await page.evaluate(
    ([nextRole, member]) =>
      localStorage.setItem(
        "gatherflow:session",
        JSON.stringify({ role: nextRole, teamMemberId: member }),
      ),
    [role, teamMemberId] as const,
  );
}

/** Reads a collection straight from storage, for asserting on stored state. */
export async function readCollection<T>(page: Page, name: string): Promise<T[]> {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(`gatherflow:v1:${key}`);
    if (!raw) return [];
    return (JSON.parse(raw).data ?? []) as unknown[];
  }, name) as Promise<T[]>;
}

/** Ticks a checkbox by clicking its label, which is what a person does. */
export async function tickByLabel(page: Page, id: string): Promise<void> {
  await page.locator(`label[for="${id}"]`).click();
}
