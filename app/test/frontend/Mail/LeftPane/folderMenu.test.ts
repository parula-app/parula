// @vitest-environment happy-dom
import { MailAccount } from "../../../../logic/Mail/MailAccount";
import { Folder, SpecialFolder } from "../../../../logic/Mail/Folder";
import { DummyMailStorage } from "../../../../logic/Mail/Store/DummyMailStorage";
import { sleep } from "../../../../logic/util/util";
import FolderMenu from "../../../../frontend/Mail/LeftPane/FolderMenu.svelte";
import { flushSync, mount } from "svelte";
import { expect, test } from "vitest";

const kMessageCount = 5;

function newTestTrash(): Folder {
  let account = new MailAccount();
  account.name = "Test";
  account.emailAddress = "user@example.com";
  account.storage = new DummyMailStorage();
  account.contentStorage.clear();
  let trash = new Folder(account);
  trash.name = "Trash";
  trash.id = "Trash";
  trash.specialFolder = SpecialFolder.Trash;
  account.rootFolders.add(trash);
  for (let i = 0; i < kMessageCount; i++) {
    let email = trash.newEMail();
    email.id = `msg${i}@example.com`;
    email.pID = email.id;
    email.subject = `Test ${i}`;
    email.sent = new Date(2026, 8, 1, 12, i);
    email.received = email.sent;
    trash.messages.addAll([email]);
  }
  return trash;
}

test("Delete all messages deletes all of them, not only every other one", async () => {
  let trash = newTestTrash();
  expect(trash.messages.length).toBe(kMessageCount);

  let target = document.createElement("div");
  document.body.append(target);
  mount(FolderMenu, { target, props: { folder: trash } });
  flushSync();

  let deleteAllButton = [...target.querySelectorAll("button")]
    .find(button => button.textContent.includes("Delete all messages"));
  deleteAllButton.click();
  await sleep(0); // the click handler is `async`, and we get no promise

  expect(trash.messages.contents.map(msg => msg.subject)).toEqual([]);
});
