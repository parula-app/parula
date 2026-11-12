// @vitest-environment happy-dom
// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { MailAccount } from "../../../../logic/Mail/MailAccount";
import { Folder } from "../../../../logic/Mail/Folder";
import type { EMail } from "../../../../logic/Mail/EMail";
import { DummyMailStorage } from "../../../../logic/Mail/Store/DummyMailStorage";
import { findOrCreatePersonUID } from "../../../../logic/Abstract/PersonUID";
import TableMessageList from "../../../Mail/3pane/TableMessageList.svelte";
import { ArrayColl } from "svelte-collections";
import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeAll, expect, test } from "vitest";

beforeAll(() => {
  (globalThis as any).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(() => {
  document.body.innerHTML = "";
});

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
    folder.messages.add(email);
  }
  return folder;
}

test("A scroll event that arrives after the message list was closed causes no error", () => {
  let folder = newTestFolder();
  let list = mount(TableMessageList, { target: document.body, props: {
    messages: folder.messages,
    folder,
    selectedMessages: new ArrayColl<EMail>(),
    selectedMessage: null,
  } });
  flushSync();
  let listEl = document.querySelector(".message-list");
  expect(listEl).toBeTruthy();

  let errors: Error[] = [];
  function onError(errorEvent: ErrorEvent) {
    errors.push(errorEvent.error);
  }
  window.addEventListener("error", onError);
  try {
    // The browser fires the scroll event of a scroll only with the next frame,
    // e.g. when the user switches to another view right after scrolling
    unmount(list);
    listEl.dispatchEvent(new window.Event("scroll"));
  } finally {
    window.removeEventListener("error", onError);
  }
  expect(errors).toEqual([]);
});
