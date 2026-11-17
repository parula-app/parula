import { MailAccount } from "../../../../logic/Mail/MailAccount";
import { MailZIP } from "../../../../logic/Mail/Store/MailZIP";
import { appGlobal } from "../../../../logic/app";
import { connectToBackend } from "../../util/backend";
import fs from 'node:fs/promises';
import { test, expect, beforeAll } from "vitest";

beforeAll(connectToBackend);

test("Create ZIP", async () => {
  let filename = "/tmp/test.zip";
  let zip = await appGlobal.remoteApp.newAdmZIP(filename);

  // Test that the file exists
  await fs.rm(filename); // throws when it doesn't exist
});

test("Write email to ZIP", async () => {
  let account = new MailAccount();
  account.name = "1234";
  account.hostname = "example.com";
  account.emailAddress = "test@example.com";
  let folder = account.newFolder();
  folder.name = "inbox";
  let email = folder.newEMail();
  email.subject = "Info";
  email.sent = new Date();
  email.dbID = 1234;
  email.mime = Buffer.from("Hello World");

  let zipper = new MailZIP();
  await zipper.save(email);

  let zip = await zipper.getFolderZIP(folder);
  let filename = await zipper.getFolderZIPFilePath(folder);
  await zipper.writeZip(zip, filename);
  // Now it should be written to disk

  // Read it independently from the write
  let zipFile = await appGlobal.remoteApp.newAdmZIP(filename);
  // <copied from="MailZIP.read()">
  let file = await zipFile.getEntry(zipper.getEMailFilename(email));
  let mime = await zipFile.readFile(file) as Uint8Array;
  // </copied>
  expect(mime).toStrictEqual(email.mime);
  await fs.rm(filename);
});
