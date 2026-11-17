// @vitest-environment happy-dom
import { appGlobal } from "../../../../logic/app";
import { MailAccount } from "../../../../logic/Mail/MailAccount";
import { Folder, SpecialFolder } from "../../../../logic/Mail/Folder";
import type { EMail } from "../../../../logic/Mail/EMail";
import { DummyMailStorage } from "../../../../logic/Mail/Store/DummyMailStorage";
import { findOrCreatePersonUID } from "../../../../logic/Abstract/PersonUID";
import { sleep } from "../../../../logic/util/util";
import MessageToolbarHarness from "./MessageToolbarHarness.svelte";
import { flushSync, mount, unmount } from "svelte";
import { writable } from "svelte/store";
import { afterEach, beforeAll, expect, test } from "vitest";

beforeAll(() => {
  (globalThis as any).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

/** Lets the test decide when a delete finishes */
let deleteFinished: (() => void)[] = [];

function newTestFolder(): Folder {
  appGlobal.remoteApp = {} as any;
  let account = new MailAccount();
  account.name = "Test";
  account.emailAddress = "user@example.com";
  account.storage = new DummyMailStorage();
  account.contentStorage.clear();
  let folder = new Folder(account);
  folder.name = "INBOX";
  folder.id = "INBOX";
  folder.specialFolder = SpecialFolder.Inbox;
  account.rootFolders.add(folder);
  for (let i = 0; i < 2; i++) {
    let email = folder.newEMail();
    email.id = `msg${i}@example.com`;
    email.pID = email.id;
    email.subject = "Test " + i;
    email.sent = new Date(2026, 8, 1, 12, -i);
    email.received = email.sent;
    email.from = findOrCreatePersonUID("alice@example.com", "Alice");
    email.contact = email.from;
    // The server never answers, like a TCP connection that silently died
    email.deleteMessageOnServer = () =>
      new Promise<void>(resolve => deleteFinished.push(resolve));
    folder.messages.add(email);
  }
  return folder;
}

let app: any;
let target: HTMLElement;

afterEach(() => {
  for (let finish of deleteFinished) {
    finish();
  }
  deleteFinished = [];
  if (app) {
    unmount(app);
    app = null;
  }
});

function deleteButton(): HTMLButtonElement {
  return target.querySelector(".trash button");
}

test("the next mail gets its own [Delete] button, not the running one of the previous mail", async () => {
  let folder = newTestFolder();
  let mails = folder.messages.contents as EMail[];
  let selected = writable(mails[0]);
  target = document.createElement("div");
  document.body.append(target);
  app = mount(MessageToolbarHarness, { target, props: { message: selected } });
  flushSync();

  expect(deleteButton().disabled).toBe(false);

  deleteButton().click();
  flushSync();
  await sleep(0.01);
  flushSync();
  expect(deleteFinished.length).toBe(1);
  expect(deleteButton().disabled).toBe(true);

  // The mail list moves on, while the delete still runs
  selected.set(mails[1]);
  flushSync();
  await sleep(0.01);
  flushSync();

  // The new mail's [Delete] must work, however long the previous one takes
  expect(deleteButton().disabled).toBe(false);
  deleteButton().click();
  flushSync();
  await sleep(0.01);
  flushSync();
  expect(deleteFinished.length).toBe(2);
});
