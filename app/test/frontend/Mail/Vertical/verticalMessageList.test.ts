// @vitest-environment happy-dom
import { appGlobal } from "../../../../logic/app";
import { MailAccount } from "../../../../logic/Mail/MailAccount";
import { Folder, SpecialFolder } from "../../../../logic/Mail/Folder";
import type { EMail } from "../../../../logic/Mail/EMail";
import { DummyMailStorage } from "../../../../logic/Mail/Store/DummyMailStorage";
import { findOrCreatePersonUID } from "../../../../logic/Abstract/PersonUID";
import { sleep } from "../../../../logic/util/util";
import VerticalMessageList from "../../../../frontend/Mail/Vertical/VerticalMessageList.svelte";
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

/** Lets the test decide when the server answers */
let starFinished: (() => void)[] = [];
let starringOnServer: EMail[] = [];

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
    email.markStarred = function() {
      starringOnServer.push(this);
      return new Promise<void>(resolve => starFinished.push(resolve));
    };
    email.deleteMessageOnServer = async () => {};
    folder.messages.add(email);
  }
  return folder;
}

let app: any;
let target: HTMLElement;

afterEach(() => {
  for (let finish of starFinished) {
    finish();
  }
  starFinished = [];
  starringOnServer = [];
  if (app) {
    unmount(app);
    app = null;
  }
});

function firstRowStarButton(): HTMLButtonElement {
  return target.querySelector(".row .star button");
}

test("the row of the next mail gets its own [Star] button, not the running one of the mail that left", async () => {
  let folder = newTestFolder();
  let mails = folder.messages.contents as EMail[];
  target = document.createElement("div");
  document.body.append(target);
  app = mount(VerticalMessageList, { target, props: {
    messages: folder.messages,
    selectedMessages: new ArrayColl<EMail>(),
    selectedMessage: null,
  } });
  flushSync();

  firstRowStarButton().click();
  flushSync();
  await sleep(0.01);
  flushSync();
  expect(starringOnServer.map(mail => mail.subject)).toEqual(["Test 0"]);

  // The mail leaves the list, e.g. deleted from the keyboard, and
  // FastList shows the next mail in the same row, while the server still has not answered
  await mails[0].deleteMessage();
  flushSync();
  await sleep(0.01);
  flushSync();
  expect(folder.messages.contents.map(mail => mail.subject)).toEqual(["Test 1", "Test 2"]);

  expect(firstRowStarButton().disabled).toBe(false);
  firstRowStarButton().click();
  flushSync();
  await sleep(0.01);
  flushSync();
  expect(starringOnServer.map(mail => mail.subject)).toEqual(["Test 0", "Test 1"]);
});
