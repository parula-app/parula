import { setupTestFolder, newTestEMail, addTestAttachment } from "./setup";
import { Folder } from "../../../../logic/Mail/Folder";
import type { EMail } from "../../../../logic/Mail/EMail";
import { SQLEMail } from "../../../../logic/Mail/SQL/SQLEMail";
import { getTagByName } from "../../../../logic/Abstract/Tag";
import { findOrCreatePersonUID } from "../../../../logic/Abstract/PersonUID";
import { beforeAll, expect, test } from "vitest";

let folder: Folder;
let saved: EMail[];

beforeAll(async () => {
  ({ folder } = await setupTestFolder({
    getFilesDir: async () => "/files", // for `readAll()`
  }));
  saved = [1, 2, 3].map(i => {
    let email = newTestEMail(folder, `read${i}@example.com`);
    email.sent = new Date(`2026-07-1${i}T10:00:00Z`);
    email.text = `Text ${i}`;
    email.cc.add(findOrCreatePersonUID(`cc${i}@example.com`, `CC ${i}`));
    addTestAttachment(email, `file${i}.pdf`, `file${i}`);
    email.tags.add(getTagByName(`tag${i}`));
    return email;
  });
  await SQLEMail.saveMultiple(saved as any);
  for (let email of saved) {
    await SQLEMail.saveTags(email);
  }
});

/** The same folder, but without its emails in memory, as after a restart */
function sameFolderEmpty(): Folder {
  let empty = new Folder(folder.account);
  empty.dbID = folder.dbID;
  return empty;
}

function expectSameEMail(read: EMail, original: EMail) {
  expect(read.id).toBe(original.id);
  expect(read.text).toBe(original.text);
  expect(read.from.emailAddress).toBe(original.from.emailAddress);
  expect(read.cc.contents.map(person => person.emailAddress)).toEqual(original.cc.contents.map(person => person.emailAddress));
  expect(read.attachments.contents.map(attachment => attachment.filename)).toEqual(original.attachments.contents.map(attachment => attachment.filename));
  expect(read.tags.contents.map(tag => tag.name)).toEqual(original.tags.contents.map(tag => tag.name));
}

test("Reads an email with its recipients, attachments and tags", async () => {
  let email = folder.newEMail();

  await SQLEMail.read(saved[0].dbID as number, email);

  expectSameEMail(email, saved[0]);
});

test("Reading an email that's not in the database fails", async () => {
  await expect(SQLEMail.read(999999, folder.newEMail())).rejects.toThrow();
});

test("Reads all emails of a folder, with their recipients, attachments and tags", async () => {
  let readFolder = sameFolderEmpty();

  await SQLEMail.readAll(readFolder);

  expect(readFolder.messages.length).toBe(saved.length);
  for (let original of saved) {
    expectSameEMail(readFolder.messages.find(email => email.id == original.id), original);
  }
});

test("Reads a folder page by page, newest first, and doesn't read an email twice", async () => {
  let readFolder = sameFolderEmpty();
  await SQLEMail.readAll(readFolder, 2);
  expect(readFolder.messages.contents.map(email => email.id)).toEqual(["read3@example.com", "read2@example.com"]);
  let read2 = readFolder.messages.getIndex(1);
  saved[1].isRead = true;
  await SQLEMail.saveWritableProps(saved[1]);

  await SQLEMail.readAll(readFolder, 2, 1);

  expect(readFolder.messages.contents.map(email => email.id)).toEqual(["read3@example.com", "read2@example.com", "read1@example.com"]);
  expect(readFolder.messages.getIndex(1)).toBe(read2);
  expect(read2.isRead).toBe(true); // updated from the database
  expectSameEMail(readFolder.messages.getIndex(2), saved[0]);
});
