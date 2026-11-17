// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { setupTestFolder, newTestEMail } from "../SQL/setup";
import type { Folder } from "../../../../logic/Mail/Folder";
import { SQLEMail } from "../../../../logic/Mail/SQL/SQLEMail";
import { MailDir } from "../../../../logic/Mail/Store/MailDir";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { beforeAll, expect, test } from "vitest";

let folder: Folder;
let tempDir: string;

beforeAll(async () => {
  ({ folder, tempDir } = await setupTestFolder({
    getFilesDir: () => path.join(tempDir, "files"),
    // JPC delivers the backend's `ArrayBuffer` as `Uint8Array`
    async readFile(filepath: string): Promise<Uint8Array> {
      return new Uint8Array(await fsPromises.readFile(filepath));
    },
    // <copied from="desktop/backend/backend.ts">
    async writeFile(filepath: string, permissions: number, contents: Uint8Array): Promise<void> {
      await fsPromises.rm(filepath, { force: true });
      let fileHandle = await fsPromises.open(filepath, "w", permissions);
      await fileHandle.write(contents);
      await fileHandle.close();
    },
    async deleteFile(filepath: string): Promise<void> {
      await fsPromises.unlink(filepath);
    },
    // </copied>
    fs: fsPromises,
  }));
});

test("Saves, reads and deletes the MIME source as a file", async () => {
  let storage = new MailDir();
  let email = newTestEMail(folder, "msg1@example.com");
  email.text = "Hello";
  email.mime = new TextEncoder().encode("Subject: Test\r\n\r\nHello\r\n");
  await SQLEMail.save(email);
  await storage.save(email);
  let filepath = await storage.getFilePath(email);
  expect(filepath).toBe(path.join(tempDir, "files", "backup", "email", "individual", "user-example.com-" + folder.account.id, "INBOX", email.dbID + ".eml"));
  expect((await fsPromises.stat(filepath)).mode & 0o777).toBe(0o400);

  let copy = newTestEMail(folder, "msg1@example.com");
  copy.dbID = email.dbID;
  await storage.read(copy);
  expect(new TextDecoder().decode(copy.mime)).toBe("Subject: Test\r\n\r\nHello\r\n");

  await storage.deleteIt(email);
  await expect(fsPromises.stat(filepath)).rejects.toThrow();
  await storage.deleteIt(email); // already gone: not an error
  let gone = newTestEMail(folder, "msg1@example.com");
  gone.dbID = email.dbID;
  await storage.read(gone);
  expect(gone.mime).toBeUndefined();
});

test("Lists the emails saved in the folder", async () => {
  let storage = new MailDir();
  for (let subject of ["One", "Two"]) {
    let email = newTestEMail(folder, subject + "@example.com");
    email.text = subject;
    email.mime = new TextEncoder().encode(`Subject: ${subject}\r\n\r\n${subject}\r\n`);
    await SQLEMail.save(email);
    await storage.save(email);
  }
  let emails = await storage.readAll(folder);
  expect(emails.contents.map(email => email.subject).sort()).toEqual(["One", "Two"]);
});
