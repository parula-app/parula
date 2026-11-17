// @vitest-environment happy-dom
// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { MailAccount } from "../../../../logic/Mail/MailAccount";
import { MailIdentity } from "../../../../logic/Mail/MailIdentity";
import { Folder, SpecialFolder } from "../../../../logic/Mail/Folder";
import type { EMail } from "../../../../logic/Mail/EMail";
import { DummyMailStorage } from "../../../../logic/Mail/Store/DummyMailStorage";
import { PersonUID } from "../../../../logic/Abstract/PersonUID";
import { sleep } from "../../../../logic/util/util";
import { openSettingsCategoryForAccount } from "../../../../frontend/Settings/Window/CategoriesUtils";
import MailComposer from "../../../../frontend/Mail/Composer/MailComposer.svelte";
import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";

vi.mock("../../../../frontend/Settings/Window/CategoriesUtils", () => ({ openSettingsCategoryForAccount: vi.fn() }));

beforeAll(() => {
  (globalThis as any).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollTo ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

let account: MailAccount;
let identity: MailIdentity;
let mail: EMail;
let app: Record<string, any> | null = null;

beforeEach(async () => {
  appGlobal.remoteApp = {} as any;
  account = new MailAccount();
  account.name = "Test";
  account.emailAddress = "user@example.com";
  account.realname = "Test User";
  account.storage = new DummyMailStorage();
  identity = new MailIdentity(account);
  identity.emailAddress = account.emailAddress;
  identity.realname = account.realname;
  identity.signatureHTML = "<p>Test User</p>";
  identity.altSignatures.addAll(["<p>Test User</p><p>Work Inc.</p>", ""]);
  account.identities.add(identity);
  for (let specialFolder of [SpecialFolder.Inbox, SpecialFolder.Sent, SpecialFolder.Drafts]) {
    let folder = new Folder(account);
    folder.name = folder.id = specialFolder;
    folder.specialFolder = specialFolder;
    account.rootFolders.add(folder);
  }
  appGlobal.emailAccounts.add(account);
  mail = account.newEMailFrom();
  mail.identity = identity;
  mail.subject = "Hello";
  mail.to.add(new PersonUID("fred@example.com", "Fred"));

  let target = document.createElement("div");
  document.body.append(target);
  app = mount(MailComposer, { target, props: { mail } });
  flushSync();
  // The text editor starts asynchronously
  await vi.waitFor(() => expect(signatureInEditor()).toBe("Test User"));
});

afterEach(() => {
  unmount(app);
  app = null;
  document.body.innerHTML = "";
  appGlobal.emailAccounts.remove(account);
  vi.restoreAllMocks();
});

function signatureInEditor(): string | null {
  return document.querySelector(".editor [contenteditable] footer.signature")?.textContent ?? null;
}

async function openMenu(): Promise<HTMLButtonElement[]> {
  let button = Array.from(document.querySelectorAll("button"))
    .find(button => button.title == "Signature");
  expect(button).toBeTruthy();
  button.click();
  await sleep(0); // `Button` is busy until its click handler returned
  flushSync();
  return Array.from(document.querySelectorAll("button.menuitem"));
}

test("The Signature menu lists the signatures of the From identity, and marks the one in the mail", async () => {
  let items = await openMenu();
  expect(items.map(item => item.textContent.trim())).toEqual(["Test User", "Test User · Work Inc.", "Manage signatures…"]);
  expect(items.map(item => item.classList.contains("selected"))).toEqual([true, false, false]);
});

test("Picking a signature swaps it in the mail", async () => {
  (await openMenu()).find(item => item.textContent.includes("Work Inc.")).click();
  flushSync();
  await vi.waitFor(() => expect(signatureInEditor()).toBe("Test UserWork Inc."));
  expect(mail.rawHTMLDangerous).toContain("Work Inc.");
  let items = await openMenu();
  expect(items.map(item => item.classList.contains("selected"))).toEqual([false, true, false]);
});

test("Manage signatures opens the identity settings of the account", async () => {
  (await openMenu()).find(item => item.textContent.includes("Manage signatures")).click();
  expect(openSettingsCategoryForAccount).toHaveBeenCalledWith(account, "mail-identity");
});
