// @vitest-environment happy-dom
// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../../logic/app";
import { MailAccount } from "../../../../logic/Mail/MailAccount";
import { SettingsCategory } from "../../../../frontend/Settings/SettingsCategory";
// Registers the account settings, which a click on an account opens
import "../../../../frontend/Settings/SettingsCategories";
import CategoriesPane from "../../../../frontend/Settings/Window/CategoriesPane.svelte";
import { selectedAccount, selectedCategory } from "../../../../frontend/Settings/Window/selected";
import { ArrayColl } from "svelte-collections";
import { flushSync, mount, unmount } from "svelte";
import { get } from "svelte/store";
import { afterEach, beforeAll, beforeEach, expect, test } from "vitest";

let general: SettingsCategory;
let mail: SettingsCategory;
let calendar: SettingsCategory;
let work: MailAccount;
let app: Record<string, any> | null = null;

beforeAll(() => {
  // happy-dom has no layout
  Element.prototype.scrollIntoView ??= () => {};
});

beforeEach(() => {
  general = new SettingsCategory("general", "General", null, true);
  general.subCategories.add(new SettingsCategory("appearance", "Appearance"));
  general.subCategories.add(new SettingsCategory("language", "Language"));
  mail = new SettingsCategory("mail", "Mail", null, true);
  work = new MailAccount();
  work.name = "Work";
  mail.accounts.add(work);
  calendar = new SettingsCategory("calendar", "Calendar", null, true);
  selectedAccount.set(null);
  selectedCategory.set(general);
  let target = document.createElement("div");
  document.body.append(target);
  app = mount(CategoriesPane, { target, props: { categories: new ArrayColl([general, mail, calendar]) } });
  flushSync();
});

afterEach(() => {
  unmount(app);
  app = null;
  document.body.innerHTML = "";
});

/** The categories and accounts, in the order shown */
function shownRows(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(".settings-categories-pane :is(.settings-category, .account)")];
}

function selectedRow(): HTMLElement {
  return shownRows().find(row => row.classList.contains("selected"));
}

/** The category rows can't take the focus, so the pane gets it when the user clicks into it */
function press(key: string): boolean {
  let pane = document.querySelector<HTMLElement>(".settings-categories-pane");
  pane.focus();
  expect(document.activeElement).toBe(pane);
  let event = new KeyboardEvent("keydown", { key, cancelable: true, bubbles: true });
  pane.dispatchEvent(event);
  flushSync();
  return event.defaultPrevented;
}

test("Arrow keys, Home and End select the categories and accounts as shown", () => {
  expect(press("ArrowDown")).toBe(true);
  expect(get(selectedCategory).name).toBe("Appearance");
  press("ArrowDown");
  press("ArrowDown");
  expect(get(selectedCategory)).toBe(mail);
  press("ArrowDown");
  expect(get(selectedAccount)).toBe(work);
  expect(document.querySelector(".settings-categories-pane .account.selected")?.textContent.trim()).toBe("Work");

  expect(press("End")).toBe(true);
  expect(get(selectedCategory)).toBe(calendar);
  // The pages of the account stay open, so Arrow Up goes to its last page
  let above = shownRows()[shownRows().indexOf(selectedRow()) - 1];
  press("ArrowUp");
  expect(selectedRow()).toBe(above);
  expect(press("Home")).toBe(true);
  expect(get(selectedCategory)).toBe(general);
  expect(press("ArrowUp")).toBe(true);
  expect(get(selectedCategory)).toBe(general);
});
