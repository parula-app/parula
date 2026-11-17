// @vitest-environment happy-dom
import { appGlobal } from "../../../../logic/app";
import { MailAccount } from "../../../../logic/Mail/MailAccount";
import { Folder, SpecialFolder } from "../../../../logic/Mail/Folder";
import type { EMail } from "../../../../logic/Mail/EMail";
import { DummyMailStorage } from "../../../../logic/Mail/Store/DummyMailStorage";
import { findOrCreatePersonUID } from "../../../../logic/Abstract/PersonUID";
import { sleep } from "../../../../logic/util/util";
import AttachmentsHarness from "./AttachmentsHarness.svelte";
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

/** Lets the test decide when the OS app finished opening the file */
let openFinished: (() => void)[] = [];
/** The files that we handed to the OS */
let opened: string[] = [];

function newTestFolder(): Folder {
  opened = [];
  appGlobal.remoteApp = {
    getIconForLocalFile: async () => null,
    getIconForFileType: async () => null,
    openFileInNativeApp: async (filePath: string) => {
      opened.push(filePath);
      return new Promise<void>(resolve => openFinished.push(resolve));
    },
  } as any;
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
    let attachment = email.newAttachment();
    attachment.filename = `invoice${i}.pdf`;
    attachment.mimeType = "application/pdf";
    attachment.contentID = `<cid${i}>`;
    attachment.content = new File([new Uint8Array([1, 2, 3])], attachment.filename, { type: attachment.mimeType });
    attachment.size = 3;
    attachment.filepathLocal = `/tmp/invoice${i}.pdf`;
    attachment.executable = null; // checked, runs no code
    email.attachments.add(attachment);
    folder.messages.add(email);
  }
  return folder;
}

let app: any;
let target: HTMLElement;

afterEach(() => {
  for (let finish of openFinished) {
    finish();
  }
  openFinished = [];
  if (app) {
    unmount(app);
    app = null;
  }
});

function attachmentUI(): HTMLElement {
  return target.querySelector(".attachment").parentElement;
}

async function click(element: HTMLElement) {
  element.click();
  flushSync();
  await sleep(0.01);
  flushSync();
}

test("Opening an attachment leaves it clickable for the next mail", async () => {
  let folder = newTestFolder();
  let mails = folder.messages.contents as EMail[];
  let selected = writable(mails[0]);
  target = document.createElement("div");
  document.body.append(target);
  app = mount(AttachmentsHarness, { target, props: { message: selected } });
  flushSync();
  await sleep(0.01);
  flushSync();

  expect(attachmentUI().classList.contains("disabled")).toBe(false);

  await click(attachmentUI());
  expect(opened).toEqual(["/tmp/invoice0.pdf"]);

  // The user reads the next mail, while the OS app still starts up
  selected.set(mails[1]);
  await sleep(0.01);
  flushSync();

  // The next mail's attachment must be openable, however long the previous one takes
  expect(attachmentUI().classList.contains("disabled")).toBe(false);
  await click(attachmentUI());
  expect(opened).toEqual(["/tmp/invoice0.pdf", "/tmp/invoice1.pdf"]);
});

test("An attachment can be opened again, however long the OS app takes", async () => {
  let folder = newTestFolder();
  let mails = folder.messages.contents as EMail[];
  let selected = writable(mails[0]);
  target = document.createElement("div");
  document.body.append(target);
  app = mount(AttachmentsHarness, { target, props: { message: selected } });
  flushSync();
  await sleep(0.01);
  flushSync();

  await click(attachmentUI());
  expect(opened).toEqual(["/tmp/invoice0.pdf"]);

  // The OS never tells us that the PDF viewer finished starting up
  expect(attachmentUI().classList.contains("disabled")).toBe(false);
  await click(attachmentUI());
  expect(opened).toEqual(["/tmp/invoice0.pdf", "/tmp/invoice0.pdf"]);
});
