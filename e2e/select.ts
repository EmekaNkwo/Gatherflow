import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Driving the app's SelectField (shadcn Select on Base UI) the way a person
 * does: open it, pick an option by its visible name. It is not a native
 * <select>, so Playwright's selectOption does not apply.
 */
export async function choose(page: Page, trigger: Locator, option: string | { index: number }): Promise<void> {
  await trigger.click();
  const listbox = page.getByRole("listbox");
  await expect(listbox).toBeVisible();
  const target =
    typeof option === "string"
      ? listbox.getByRole("option", { name: option, exact: true })
      : listbox.getByRole("option").nth(option.index);
  await target.click();
  await expect(listbox).toBeHidden();
}

/** The visible names of a SelectField's options, read by opening it and closing it again. */
export async function optionNames(page: Page, trigger: Locator): Promise<string[]> {
  await trigger.click();
  const listbox = page.getByRole("listbox");
  await expect(listbox).toBeVisible();
  const names = await listbox.getByRole("option").allTextContents();
  await page.keyboard.press("Escape");
  await expect(listbox).toBeHidden();
  return names.map((name) => name.trim());
}
