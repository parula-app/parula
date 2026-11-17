// @vitest-environment happy-dom
// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../logic/app";
import { MailAccount } from "../../../logic/Mail/MailAccount";
import { Folder, SpecialFolder } from "../../../logic/Mail/Folder";
import { DummyMailStorage } from "../../../logic/Mail/Store/DummyMailStorage";
import { Observable, notifyChangedProperty } from "../../../logic/util/Observable";
import { sleep } from "../../../logic/util/util";
import { selectedAccount, selectedFolder } from "../../../frontend/Mail/Selected";
import { mailMustangApp, type WriteMailMustangApp } from "../../../frontend/Mail/MailMustangApp";
import MailInBackground from "../../../frontend/Mail/MailInBackground.svelte";
import { flushSync, mount, unmount } from "svelte";
import { afterEach, expect, test } from "vitest";

/** Same as `StartupArgs` in desktop/backend/backend.ts */
class TestStartupArgs extends Observable {
  @notifyChangedProperty
  url: string | null = null;
  @notifyChangedProperty
  file: string | null = null;
  handled() {
    this.url = null;
  }
}

function newTestFolder(account: MailAccount, name: string, specialFolder: SpecialFolder): Folder {
  let folder = new Folder(account);
  folder.name = name;
  folder.id = name;
  folder.specialFolder = specialFolder;
  return folder;
}

let app: Record<string, any>;
afterEach(() => {
  unmount(app);
  appGlobal.emailAccounts.clear();
  mailMustangApp.subApps.clear();
  selectedAccount.set(null);
  selectedFolder.set(null);
});

test("mailto: at app start waits for the folders", async () => {
  let account = new MailAccount();
  account.name = "Test";
  account.emailAddress = "user@example.com";
  account.storage = new DummyMailStorage();
  appGlobal.emailAccounts.add(account);
  let startupArgs = new TestStartupArgs();
  startupArgs.url = "mailto:alice@example.com?subject=Hello";
  appGlobal.remoteApp = { startupArgs, unminimizeMainWindow: async () => {} } as any;

  let target = document.createElement("div");
  document.body.append(target);
  app = mount(MailInBackground, { target });
  flushSync();
  // The accounts are there, but their folders are still being read from the database
  expect(startupArgs.url).toBeNull();
  await sleep(0.05);
  expect(mailMustangApp.subApps.hasItems).toBe(false);

  // The folders arrive, and `MailApp` selects the inbox
  let inbox = newTestFolder(account, "Inbox", SpecialFolder.Inbox);
  let sent = newTestFolder(account, "Sent", SpecialFolder.Sent);
  account.rootFolders.addAll([inbox, sent]);
  selectedAccount.set(account);
  selectedFolder.set(inbox);
  await sleep(0.3); // `waitForStartup()` polls every 100 ms

  expect(mailMustangApp.subApps.length).toBe(1);
  let composer = mailMustangApp.subApps.first as WriteMailMustangApp;
  let mail = composer.windowParams.mail;
  expect(mail.folder).toBe(sent);
  expect(mail.to.first.emailAddress).toBe("alice@example.com");
  expect(mail.subject).toBe("Hello");
});
