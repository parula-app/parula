// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../logic/app";
import { setupTestFolder } from "./SQL/setup";
import { MailIdentity } from "../../../logic/Mail/MailIdentity";
import { CreateMIME } from "../../../logic/Mail/SMTP/CreateMIME";
import type { EMail } from "../../../logic/Mail/EMail";
import type { MailAccount } from "../../../logic/Mail/MailAccount";
import { Folder, SpecialFolder } from "../../../logic/Mail/Folder";
import { expect, test, beforeAll, beforeEach } from "vitest";

/** The files on the disk, by path */
let disk = new Map<string, Uint8Array>();
let diskIsFull = false;
/** The MIME source of the drafts that the server got */
let onServer: string[] = [];
let server: "saves" | "fails" | "hangs" | "rejects noon" = "saves";
let account: MailAccount;
let accountErrors: Error[] = [];
let identity: MailIdentity;

beforeAll(async () => {
  let { folder } = await setupTestFolder({
    // Stands in for nodemailer in the backend
    getMIMENodemailer: async (mail: any) => new TextEncoder().encode(
      `Message-ID: <${mail.messageId}>\r\nSubject: ${mail.subject}\r\n\r\n${mail.text}\r\n\r\n${mail.html}`),
    getConfigDir: async () => "/config",
    fs: {
      mkdir: async () => {},
      readdir: async (dir: string) => {
        let filenames = [...disk.keys()]
          .filter(path => path.startsWith(dir + "/"))
          .map(path => path.substring(dir.length + 1));
        if (!filenames.length) {
          throw Object.assign(new Error("No such directory " + dir), { code: "ENOENT" });
        }
        return filenames;
      },
    },
    writeFile: async (path: string, permissions: number, contents: Uint8Array) => {
      if (diskIsFull) {
        throw new Error("No space left on device");
      }
      disk.set(path, contents);
    },
    readFile: async (path: string) => disk.get(path),
    deleteFile: async (path: string) => {
      disk.delete(path);
    },
  });
  account = folder.account;
  identity = new MailIdentity(account);
  identity.emailAddress = "user@example.com";
  account.identities.add(identity);

  let drafts = new Folder(account);
  drafts.name = "Drafts";
  drafts.specialFolder = SpecialFolder.Drafts;
  // What the protocol implementations do
  drafts.addMessage = async (message: EMail) => {
    if (server == "fails") {
      throw new Error("The server is down");
    }
    if (server == "hangs") {
      await new Promise(() => {});
    }
    message.mime ??= await CreateMIME.getMIME(message);
    let mime = new TextDecoder().decode(message.mime);
    if (server == "rejects noon" && mime.includes("noon")) {
      throw new Error("The server rejects this draft");
    }
    onServer.push(mime);
  };
  account.rootFolders.add(drafts);
});

beforeEach(() => {
  disk.clear();
  diskIsFull = false;
  onServer = [];
  server = "saves";
  accountErrors = [];
  account.errorCallback = ex => accountErrors.push(ex);
});

function newMail(text: string): EMail {
  let mail = account.newEMailFrom();
  mail.identity = identity;
  mail.subject = "Lunch";
  mail.html = `<p>${text}</p>`;
  return mail;
}

function diskContents(): string[] {
  return [...disk.values()].map(mime => new TextDecoder().decode(mime));
}

test("A draft goes to the server, when the server saves it in time", async () => {
  await newMail("See you at noon").compose.saveDraftOnQuit();
  expect(onServer.length).toBe(1);
  expect(onServer[0]).toContain("See you at noon");
  expect(disk.size).toBe(0);
});

test("A draft is kept on disk, when the server fails", async () => {
  server = "fails";
  await newMail("See you at noon").compose.saveDraftOnQuit();
  expect(onServer.length).toBe(0);
  expect(diskContents().length).toBe(1);
  expect(diskContents()[0]).toContain("See you at noon");
});

test("A draft is kept on disk, when the server takes too long", async () => {
  server = "hangs";
  // Returns although the server never answers
  await newMail("See you at noon").compose.saveDraftOnQuit();
  expect(diskContents().length).toBe(1);
  expect(diskContents()[0]).toContain("See you at noon");
});

test("Saving the draft fails, when it can't be kept on disk either", async () => {
  server = "fails";
  diskIsFull = true;
  await expect(newMail("See you at noon").compose.saveDraftOnQuit()).rejects.toThrow("No space left");
});

test("Each draft on disk is kept separately", async () => {
  server = "fails";
  await newMail("See you at noon").compose.saveDraftOnQuit();
  await newMail("The report is attached").compose.saveDraftOnQuit();
  expect(diskContents().length).toBe(2);
});

test("The next start uploads the drafts from the disk, and removes them from the disk", async () => {
  server = "fails";
  await newMail("See you at noon").compose.saveDraftOnQuit();
  server = "saves";
  await account.uploadLocalDrafts();
  expect(onServer.length).toBe(1);
  expect(onServer[0]).toContain("See you at noon");
  expect(disk.size).toBe(0);
});

test("The next start uploads nothing, when no drafts are on disk", async () => {
  await account.uploadLocalDrafts();
  expect(onServer.length).toBe(0);
});

test("The next start keeps the draft on disk, when the server fails again", async () => {
  server = "fails";
  await newMail("See you at noon").compose.saveDraftOnQuit();
  await account.uploadLocalDrafts();
  expect(accountErrors[0]?.message).toContain("The server is down");
  expect(diskContents().length).toBe(1);
});

test("The next start uploads the other drafts, when the server rejects one of them", async () => {
  server = "fails";
  await newMail("See you at noon").compose.saveDraftOnQuit();
  await newMail("The report is attached").compose.saveDraftOnQuit();
  server = "rejects noon";
  await account.uploadLocalDrafts();
  expect(onServer.length).toBe(1);
  expect(onServer[0]).toContain("The report is attached");
  expect(diskContents().length).toBe(1);
  expect(diskContents()[0]).toContain("See you at noon");
  expect(accountErrors.length).toBe(1);
});
