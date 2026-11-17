// @vitest-environment happy-dom
// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../logic/app";
import { MailAccount } from "../../../logic/Mail/MailAccount";
import { SettingsCategory } from "../../../frontend/Settings/SettingsCategory";
import CategoriesPane from "../../Settings/Window/CategoriesPane.svelte";
import { selectedAccount, selectedCategory } from "../../Settings/Window/selected";
import { openSetup } from "../../Settings/SettingsDialogs";
import { ArrayColl } from "svelte-collections";
import { flushSync, mount, unmount } from "svelte";
import { get } from "svelte/store";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";

vi.mock("../../Settings/SettingsDialogs", async importOriginal => ({
  ...await importOriginal<typeof import("../../Settings/SettingsDialogs")>(),
  openSetup: vi.fn(),
}));

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
  mail.newAccountURL = "/setup/mail";
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
  vi.mocked(openSetup).mockClear();
});

/** The texts of the entries, in the order shown */
function shownEntries(): string[] {
  return [...document.querySelectorAll(".settings-categories-pane .nav-entry")].map(entry => entry.textContent.trim());
}

function selectedEntry(): string {
  return document.querySelector(".settings-categories-pane .nav-entry.selected")?.textContent.trim();
}

/** @returns whether the pane used the key, so that the browser doesn't scroll the pane */
function press(key: string): boolean {
  let event = new KeyboardEvent("keydown", { key, cancelable: true, bubbles: true });
  document.querySelector(".settings-categories-pane .nav-entry.selected").dispatchEvent(event);
  flushSync();
  return event.defaultPrevented;
}

test("Arrow keys, Home and End select the categories and accounts as shown, but don't add an account", () => {
  expect(shownEntries()).toEqual(["General", "Appearance", "Language", "Mail", "Calendar"]);
  expect(press("ArrowDown")).toBe(true);
  expect(get(selectedCategory).name).toBe("Appearance");
  press("ArrowDown");
  press("ArrowDown");
  expect(get(selectedCategory)).toBe(mail);
  expect(shownEntries()).toContain("Work");
  expect(shownEntries().some(entry => entry.includes("Add account"))).toBe(true);

  press("ArrowDown");
  expect(get(selectedAccount)).toBe(work);
  expect(selectedEntry()).toBe("Work");

  expect(press("End")).toBe(true);
  expect(get(selectedCategory)).toBe(calendar);
  expect(get(selectedAccount)).toBeNull();
  press("ArrowUp");
  expect(get(selectedCategory)).toBe(mail);
  expect(press("Home")).toBe(true);
  expect(get(selectedCategory)).toBe(general);
  expect(openSetup).not.toHaveBeenCalled();
});

test("Arrow Down from the last account goes past Add account to the next category", () => {
  selectedCategory.set(mail);
  flushSync();
  let entries = shownEntries();
  expect(entries.indexOf("Calendar")).toBe(entries.indexOf("Work") + 2);
  press("ArrowDown");
  expect(get(selectedAccount)).toBe(work);
  // The account shows its own pages below it now
  for (let i = 0; i < 20 && get(selectedCategory) != calendar; i++) {
    press("ArrowDown");
  }
  expect(get(selectedCategory)).toBe(calendar);
  expect(openSetup).not.toHaveBeenCalled();
});
