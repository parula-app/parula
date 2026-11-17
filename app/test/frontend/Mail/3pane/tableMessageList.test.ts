// @vitest-environment happy-dom
import { appGlobal } from "../../../../logic/app";
import { MailAccount } from "../../../../logic/Mail/MailAccount";
import { Folder, SpecialFolder } from "../../../../logic/Mail/Folder";
import type { EMail } from "../../../../logic/Mail/EMail";
import { DummyMailStorage } from "../../../../logic/Mail/Store/DummyMailStorage";
import { findOrCreatePersonUID } from "../../../../logic/Abstract/PersonUID";
import { sleep } from "../../../../logic/util/util";
import TableMessageList from "../../../../frontend/Mail/3pane/TableMessageList.svelte";
import { ArrayColl } from "svelte-collections";
import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeAll, expect, test } from "vitest";

beforeAll(() => {
  (globalThis as any).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  // happy-dom has no layout, and a list of height 0 shows no rows
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    get() { return this.classList.contains("fast-list") ? 500 : 20; },
  });
});

/** Lets the test decide when a delete finishes */
let deleteFinished: (() => void)[] = [];
let deletingOnServer: EMail[] = [];

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
  for (let i = 0; i < 3; i++) {
    let email = folder.newEMail();
    email.id = `msg${i}@example.com`;
    email.pID = email.id;
    email.subject = "Test " + i;
    email.sent = new Date(2026, 8, 1, 12, -i);
    email.received = email.sent;
    email.from = findOrCreatePersonUID("alice@example.com", "Alice");
    email.contact = email.from;
    // The server never answers
    email.deleteMessageOnServer = function() {
      deletingOnServer.push(this);
      return new Promise<void>(resolve => deleteFinished.push(resolve));
    };
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
  deletingOnServer = [];
  if (app) {
    unmount(app);
    app = null;
  }
});

function firstRowDeleteButton(): HTMLButtonElement {
  return target.querySelector(".row .delete button");
}

test("the row of the next mail gets its own [Delete] button, not the running one of the deleted mail", async () => {
  let folder = newTestFolder();
  target = document.createElement("div");
  document.body.append(target);
  app = mount(TableMessageList, { target, props: {
    messages: folder.messages,
    selectedMessages: new ArrayColl<EMail>(),
    selectedMessage: null,
  } });
  flushSync();

  firstRowDeleteButton().click();
  flushSync();
  await sleep(0.01);
  flushSync();
  expect(deletingOnServer.map(mail => mail.subject)).toEqual(["Test 0"]);
  expect(folder.messages.contents.map(mail => mail.subject)).toEqual(["Test 1", "Test 2"]);

  // FastList shows the next mail in the same row, while the server still has not answered
  expect(firstRowDeleteButton().disabled).toBe(false);
  firstRowDeleteButton().click();
  flushSync();
  await sleep(0.01);
  flushSync();
  expect(deletingOnServer.map(mail => mail.subject)).toEqual(["Test 0", "Test 1"]);
});
