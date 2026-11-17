import { setupTestFolder, newTestEMail, addTestAttachment } from "./setup";
import type { Folder } from "../../../../logic/Mail/Folder";
import { SQLEMail } from "../../../../logic/Mail/SQL/SQLEMail";
import { JSONEMail } from "../../../../logic/Mail/JSON/JSONEMail";
import { RawFilesAttachment } from "../../../../logic/Mail/Store/RawFilesAttachment";
import { ExecutableKind } from "../../../../logic/Files/FileType/ExecutableFile";
import { UserError } from "../../../../logic/util/util";
import fsPromises from "node:fs/promises";
import { beforeAll, expect, test } from "vitest";

let folder: Folder;
/** The files that `openOSApp()` handed to the OS */
let opened: string[] = [];

beforeAll(async () => {
  let tempDir: string;
  ({ folder, tempDir } = await setupTestFolder({
    // The attachment files land on the real disk, in the temp dir
    getFilesDir: async () => tempDir,
    fs: fsPromises,
    writeFile: async (path: string, permissions: number, contents: Uint8Array) =>
      await fsPromises.writeFile(path, contents, { mode: permissions }),
    readFile: async (path: string) => await fsPromises.readFile(path),
    openFileInNativeApp: async (path: string) => { opened.push(path); },
  }));
  await JSONEMail.init();
});

async function roundtrip(msgID: string, filename: string, executable: ExecutableKind | null | undefined) {
  let email = newTestEMail(folder, msgID);
  addTestAttachment(email, filename, "<cid1>", new Uint8Array([1, 2, 3]));
  email.attachments.first.executable = executable;
  await SQLEMail.save(email);

  let read = folder.newEMail();
  await SQLEMail.read(email.dbID as number, read);
  return read.attachments.first;
}

test("The executable check is saved in the DB, so that we don't repeat it", async () => {
  let attachment = await roundtrip("exe@example.com", "setup.exe", ExecutableKind.program);
  expect(attachment.executable).toBe(ExecutableKind.program);
});

test("A file that runs no code is also remembered, so that we don't check it again", async () => {
  let attachment = await roundtrip("safe@example.com", "photo.jpg", null);
  expect(attachment.executable).toBe(null);
});

test("An attachment from before this check is unknown, not safe", async () => {
  let attachment = await roundtrip("old@example.com", "unknown.dat", undefined);
  expect(attachment.executable).toBe(undefined);
});

test("An attachment from before this check is read from disk and checked, when opened", async () => {
  let email = newTestEMail(folder, "old-elf@example.com");
  let attachment = addTestAttachment(email, "photo.jpg", "<cid1>",
    Uint8Array.from("\x7FELF\x02\x01\x01 a Linux program", char => char.charCodeAt(0)));
  await SQLEMail.save(email);
  await new RawFilesAttachment().save(email);
  // As if we had saved it before this check existed: only the file on disk
  attachment.executable = undefined;
  attachment.content = null;
  expect(attachment.filepathLocal).toBeTruthy();

  await expect(attachment.openOSApp()).rejects.toThrow(UserError);
  expect(attachment.executable).toBe(ExecutableKind.program);
  expect(opened).toEqual([]);
});

test("The name on disk is checked, because the OS opens the file by that name", async () => {
  let email = newTestEMail(folder, "bat@example.com");
  // `sanitize.filename()` drops the `#`, so the file on disk ends in `.bat`, which Windows runs
  let attachment = addTestAttachment(email, "invoice.b#at", "<cid1>",
    Uint8Array.from("@echo off\r\nformat c: /y", char => char.charCodeAt(0)));
  await attachment.checkExecutable(); // as `EMail.parseMIME()` does, before the file is on disk
  await SQLEMail.save(email);
  await new RawFilesAttachment().save(email);
  expect(attachment.filepathLocal).toMatch(/\.bat$/);
  expect(attachment.executable).toBe(ExecutableKind.script);

  let read = folder.newEMail();
  await SQLEMail.read(email.dbID as number, read);
  expect(read.attachments.first.executable).toBe(ExecutableKind.script);
  await expect(read.attachments.first.openOSApp()).rejects.toThrow(UserError);
  expect(opened).toEqual([]);
});
