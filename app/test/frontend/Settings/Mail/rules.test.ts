// @vitest-environment happy-dom
// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { MailAccount } from "../../../../logic/Mail/MailAccount";
import { Folder, SpecialFolder } from "../../../../logic/Mail/Folder";
import { DummyMailStorage } from "../../../../logic/Mail/Store/DummyMailStorage";
import { FilterRuleAction } from "../../../../logic/Mail/FilterRules/FilterRuleAction";
import { availableTags, getTagByName } from "../../../../logic/Abstract/Tag";
import Rules from "../../../../frontend/Settings/Mail/Rules.svelte";
import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeAll, beforeEach, expect, test } from "vitest";

beforeAll(() => {
  (globalThis as any).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

let account: MailAccount;
let target: HTMLElement;
let app: any;

beforeEach(() => {
  availableTags.clear();
  getTagByName("Important");
  getTagByName("Later");
  appGlobal.remoteApp = {} as any;
  account = new MailAccount();
  account.name = "Test";
  account.emailAddress = "user@example.com";
  account.storage = new DummyMailStorage();
  for (let [name, specialFolder] of [["INBOX", SpecialFolder.Inbox], ["Archive", SpecialFolder.Archive]] as const) {
    let folder = new Folder(account);
    folder.name = folder.id = name;
    folder.specialFolder = specialFolder;
    account.rootFolders.add(folder);
  }
});

afterEach(() => {
  unmount(app);
  target.remove();
});

function showRulesPage() {
  target = document.createElement("div");
  document.body.append(target);
  app = mount(Rules, { target, props: { account } });
  flushSync();
}

function newRule(name: string): FilterRuleAction {
  let rule = new FilterRuleAction(account);
  rule.name = name;
  account.filterRuleActions.add(rule);
  return rule;
}

function click(el: HTMLElement) {
  el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  flushSync();
}

/** In the Action box, not in the Criteria */
function checkbox(label: string): HTMLElement {
  let found = [...target.querySelectorAll("vbox.rule-action > hbox.checkbox")]
    .filter(el => el.querySelector("label")?.textContent.trim().startsWith(label));
  expect(found.length, `checkbox ${label}`).toBe(1);
  return found[0] as HTMLElement;
}

/** true = checked, false = explicitly off, null = indetermined */
function checkboxState(label: string): boolean | null {
  let el = checkbox(label);
  return el.classList.contains("on") ? true :
    el.classList.contains("off") ? false : null;
}

function clickRule(name: string) {
  let row = [...target.querySelectorAll("hbox.rule-item")]
    .find(el => el.textContent.trim() == name);
  click(row.parentElement as HTMLElement);
}

function clickFolder(name: string) {
  let line = [...target.querySelectorAll("vbox.rule-action hbox.folder")]
    .find(el => el.querySelector("hbox.label")?.textContent.trim() == name);
  click(line as HTMLElement);
}

function clickTag(name: string) {
  let bubble = [...target.querySelectorAll("vbox.rule-action hbox.tag")]
    .find(el => el.textContent.trim() == name);
  click(bubble as HTMLElement);
}

test("The tag action shows the tags to select, and stays checked", () => {
  newRule("Newsletters");
  showRulesPage();

  expect(checkboxState("Tags")).toBe(null);
  expect(target.textContent).not.toContain("Important");
  click(checkbox("Tags"));

  expect(checkboxState("Tags")).toBe(true);
  expect(target.textContent).toContain("Important");
  expect(target.textContent).toContain("Later");
});

test("The folder action shows the folders to select, and stays checked", () => {
  newRule("Newsletters");
  showRulesPage();

  expect(checkboxState("Move to folder")).toBe(null);
  click(checkbox("Move to folder"));

  expect(checkboxState("Move to folder")).toBe(true);
  expect(target.textContent).toContain("Archive");
});

test("The folder that the user picks is set on the rule", () => {
  let rule = newRule("Newsletters");
  showRulesPage();

  click(checkbox("Move to folder"));
  clickFolder("Archive");

  expect(checkboxState("Move to folder")).toBe(true);
  expect(rule.toFolder?.name).toBe("Archive");
});

test("The delete action clears the tag and folder actions", () => {
  let rule = newRule("Newsletters");
  showRulesPage();

  click(checkbox("Tags"));
  clickTag("Important");
  click(checkbox("Delete"));

  expect(checkboxState("Delete")).toBe(true);
  expect(checkboxState("Tags")).toBe(null);
  expect(rule.addTags.isEmpty).toBe(true);
});

test("The tag stays selected while the user sets other actions", () => {
  let rule = newRule("Newsletters");
  showRulesPage();

  click(checkbox("Tags"));
  clickTag("Important");
  click(checkbox("Mark as read"));

  expect(checkboxState("Tags")).toBe(true);
  expect(rule.addTags.contents.map(tag => tag.name)).toEqual(["Important"]);
  expect(rule.markAsRead).toBe(true);
});

test("The tag action of one rule is not shown for another rule", () => {
  let tagged = newRule("Newsletters");
  tagged.addTags.add(getTagByName("Important"));
  newRule("Bills");
  showRulesPage();

  clickRule("Newsletters");
  expect(checkboxState("Tags")).toBe(true);

  clickRule("Bills");
  expect(checkboxState("Tags")).toBe(null);
});

test("A tag action is still shown after selecting another rule and back", () => {
  newRule("Newsletters");
  newRule("Bills");
  showRulesPage();

  clickRule("Newsletters");
  click(checkbox("Tags"));
  clickTag("Important");
  clickRule("Bills");
  clickRule("Newsletters");

  expect(checkboxState("Tags")).toBe(true);
  expect(target.textContent).toContain("Important");
});
