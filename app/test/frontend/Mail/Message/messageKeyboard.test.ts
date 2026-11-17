// @vitest-environment happy-dom
// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { MailAccount } from "../../../../logic/Mail/MailAccount";
import { Folder, SpecialFolder } from "../../../../logic/Mail/Folder";
import type { EMail } from "../../../../logic/Mail/EMail";
import { DummyMailStorage } from "../../../../logic/Mail/Store/DummyMailStorage";
import { findOrCreatePersonUID } from "../../../../logic/Abstract/PersonUID";
import { sleep } from "../../../../logic/util/util";
import { selectedMessage, selectedMessages } from "../../../../frontend/Mail/Selected";
import { onKeyOnMessage } from "../../../../frontend/Mail/Message/MessageKeyboard";
import MessageListHarness from "./MessageListHarness.svelte";
import { ArrayColl } from "svelte-collections";
import { flushSync, mount } from "svelte";
import { get, writable } from "svelte/store";
import { beforeAll, expect, test } from "vitest";

beforeAll(() => {
  (globalThis as any).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
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
  folder.specialFolder = SpecialFolder.Inbox;
  account.rootFolders.add(folder);
  for (let i = 0; i < 5; i++) {
    let email = folder.newEMail();
    email.id = `msg${i}@example.com`;
    email.pID = email.id;
    email.subject = "Test " + i;
    email.sent = new Date(2026, 8, 1, 12, -i);
    email.received = email.sent;
    email.from = findOrCreatePersonUID("alice@example.com", "Alice");
    email.contact = email.from;
    email.deleteMessageOnServer = async function() {
      deletedOnServer.push(this);
    };
    folder.messages.add(email);
  }
  return folder;
}

let deletedOnServer: EMail[] = [];

async function pressDelete(listE: HTMLElement, message: EMail) {
  get(selectedMessages).clear();
  get(selectedMessages).add(message);
  flushSync();
  listE.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
  await sleep(0); // the key handler is `async`, and we get no promise
}

test("The Delete key deletes the selected message, also after switching the view", async () => {
  let folder = newTestFolder();
  deletedOnServer = [];
  let view = writable("vertical");
  let target = document.createElement("div");
  document.body.append(target);
  mount(MessageListHarness, { target, props: { messages: folder.messages, view } });
  flushSync();

  await pressDelete(target.querySelector(".fast-list"), folder.messages.getIndex(1));
  expect(deletedOnServer.map(msg => msg.subject)).toEqual(["Test 1"]);
  expect(folder.messages.contents.map(msg => msg.subject))
    .toEqual(["Test 0", "Test 2", "Test 3", "Test 4"]);

  // Switching destroys the old list, which must not clear the selection
  view.set("table");
  flushSync();
  expect(get(selectedMessages)).toBeTruthy();

  await pressDelete(target.querySelector(".fast-list"), folder.messages.getIndex(2));
  expect(deletedOnServer.map(msg => msg.subject)).toEqual(["Test 1", "Test 3"]);
  expect(folder.messages.contents.map(msg => msg.subject))
    .toEqual(["Test 0", "Test 2", "Test 4"]);
  expect(get(selectedMessage)).toBeTruthy();
});

test("A cursor key with no message selected does nothing", async () => {
  // The <webview> of another app, e.g. Files, forwards its keys to `onKeyOnMessage()`
  selectedMessage.set(null);
  selectedMessages.set(new ArrayColl<EMail>());
  await onKeyOnMessage(new KeyboardEvent("keydown", { key: "ArrowDown" }));
});
