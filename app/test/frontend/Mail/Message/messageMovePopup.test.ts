// @vitest-environment happy-dom
// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { MailAccount } from "../../../../logic/Mail/MailAccount";
import { Folder, SpecialFolder } from "../../../../logic/Mail/Folder";
import type { EMail } from "../../../../logic/Mail/EMail";
import { DummyMailStorage } from "../../../../logic/Mail/Store/DummyMailStorage";
import { findOrCreatePersonUID } from "../../../../logic/Abstract/PersonUID";
import { getTagByName } from "../../../../logic/Abstract/Tag";
import { sleep } from "../../../../logic/util/util";
import { waitFor } from "../../../logic/util/waitFor";
import { selectedMessage } from "../../../../frontend/Mail/Selected";
import MessageMovePopup from "../../../../frontend/Mail/Message/MessageMovePopup.svelte";
import { flushSync, mount } from "svelte";
import { ArrayColl } from "svelte-collections";
import { get } from "svelte/store";
import { beforeAll, expect, test } from "vitest";

beforeAll(() => {
  (globalThis as any).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

let movedOnServer: EMail[] = [];

function newTestAccount(): MailAccount {
  appGlobal.remoteApp = {} as any;
  let account = new MailAccount();
  account.name = "Test";
  account.emailAddress = "user@example.com";
  account.storage = new DummyMailStorage();
  account.contentStorage.clear();
  let inbox = new Folder(account);
  inbox.name = "INBOX";
  inbox.id = "INBOX";
  inbox.specialFolder = SpecialFolder.Inbox;
  account.rootFolders.add(inbox);
  let target = new Folder(account);
  target.name = "Target";
  target.id = "Target";
  (target as any).moveOrCopyMessagesOnServer = async function(action: string, messages: ArrayColl<EMail>) {
    movedOnServer.push(...messages.contents);
  };
  account.rootFolders.add(target);
  newTestEMail(inbox, "Test");
  return account;
}

function newTestEMail(folder: Folder, subject: string): EMail {
  let email = folder.newEMail();
  email.id = subject + "@example.com";
  email.pID = email.id;
  email.subject = subject;
  email.sent = new Date(2026, 8, 1, 12, 0);
  email.received = email.sent;
  email.from = findOrCreatePersonUID("alice@example.com", "Alice");
  email.contact = email.from;
  folder.messages.add(email);
  return email;
}

test("Moving the only message out of the inbox shows no message, not an empty one", async () => {
  let account = newTestAccount();
  let inbox = account.inbox;
  let email = inbox.messages.first;
  movedOnServer = [];
  selectedMessage.set(email);

  let target = document.createElement("div");
  document.body.append(target);
  mount(MessageMovePopup, { target, props: { messages: new ArrayColl([email]) } });
  flushSync();

  let moveButton = [...target.querySelectorAll("button")]
    .find(button => button.title == "Move this email to folder Target");
  moveButton.click();
  await sleep(0); // the click handler is `async`, and we get no promise

  expect(movedOnServer.map(msg => msg.subject)).toEqual(["Test"]);
  expect(inbox.messages.isEmpty).toBe(true);
  // Not a new, empty email: It has no sender and no server ID, so it shows
  // "unknown@invalid" and the server rejects the ID as malformed.
  expect(get(selectedMessage)).toBeNull();
});

test("Tagging multiple selected messages tags all of them, not only the first", async () => {
  let account = newTestAccount();
  let inbox = account.inbox;
  let first = inbox.messages.first;
  let second = newTestEMail(inbox, "Second");
  let tag = getTagByName("Important");

  let target = document.createElement("div");
  document.body.append(target);
  mount(MessageMovePopup, { target, props: { messages: new ArrayColl([first, second]) } });
  flushSync();

  let tagBubble = [...target.querySelectorAll(".tag")]
    .find(bubble => bubble.textContent.includes(tag.name)) as HTMLElement;
  tagBubble.click();
  await waitFor(() => second.tags.hasItems);

  expect(first.tags.contents).toEqual([tag]);
  expect(second.tags.contents).toEqual([tag]);
});

test("A tag that only some of the selected messages have adds it to all of them, then removes it from all", async () => {
  let account = newTestAccount();
  let inbox = account.inbox;
  let first = inbox.messages.first;
  let second = newTestEMail(inbox, "Second");
  let tag = getTagByName("Important");
  first.tags.add(tag); // as if it came from the server
  let taggedOnServer: EMail[] = [];
  let untaggedOnServer: EMail[] = [];
  for (let message of [first, second]) {
    (message as any).addTagOnServer = async () => taggedOnServer.push(message);
    (message as any).removeTagOnServer = async () => untaggedOnServer.push(message);
  }

  let target = document.createElement("div");
  document.body.append(target);
  mount(MessageMovePopup, { target, props: { messages: new ArrayColl([first, second]) } });
  flushSync();

  let tagBubble = [...target.querySelectorAll(".tag")]
    .find(bubble => bubble.textContent.includes(tag.name)) as HTMLElement;
  expect(tagBubble.classList.contains("partial")).toBe(true);

  tagBubble.click(); // adds the tag to all selected messages
  await waitFor(() => second.tags.contains(tag));
  flushSync();
  expect(taggedOnServer.map(message => message.subject)).toEqual(["Second"]); // `first` already had it
  expect(tagBubble.classList.contains("partial")).toBe(false);
  expect(tagBubble.classList.contains("selected")).toBe(true);

  tagBubble.click(); // removes it from all selected messages
  await waitFor(() => !first.tags.contains(tag) && !second.tags.contains(tag));
  flushSync();
  expect(untaggedOnServer.map(message => message.subject)).toEqual(["Test", "Second"]);
  expect(tagBubble.classList.contains("selected")).toBe(false);
});
