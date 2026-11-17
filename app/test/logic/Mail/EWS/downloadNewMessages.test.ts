// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { EWSAccount } from "../../../../logic/Mail/EWS/EWSAccount";
import type { EWSFolder } from "../../../../logic/Mail/EWS/EWSFolder";
import type { EWSEMail } from "../../../../logic/Mail/EWS/EWSEMail";
import { SpecialFolder } from "../../../../logic/Mail/Folder";
import { SQLMailStorage } from "../../../../logic/Mail/SQL/SQLMailStorage";
import { SQLSourceEMail } from "../../../../logic/Mail/SQL/Source/SQLSourceEMail";
import { getDatabase } from "../../../../logic/Mail/SQL/SQLDatabase";
import { InProcessSQLiteDatabase } from "../../util/inProcessSQLite";
import { ensureArray } from "../../../../logic/util/util";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sql from "../../../../../lib/rs-sqlite";
import { expect, test } from "vitest";

/** As many as arrive while the app was not running for 2 days */
const kNewMessages = 50;
/** Relative to now, so that they stay within the 2 weeks that we download */
const kSent = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
const kReceived = new Date(kSent.getTime() + 1000);

/** An Exchange server whose inbox has `kNewMessages` messages that we do not have yet */
class TestEWSAccount extends EWSAccount {
  /** The item IDs of each `GetItem` call that fetches the MIME source */
  readonly mimeRequests: string[][] = [];
  /** Resolved as soon as the server got the first MIME request */
  readonly gotFirstMIMERequest = Promise.withResolvers<void>();
  /** The first MIME request waits for this, so that we can act while it is in flight */
  readonly answerFirstMIMERequest = Promise.withResolvers<void>();
  blockFirstMIMERequest = false;
  /** The server is down, or the app quits, while we fetch the MIME source */
  failMIMERequests = false;
  protected sentChanges = false;

  async callEWS(request: any): Promise<any> {
    if (request.m$SyncFolderItems) {
      let created = this.sentChanges ? [] : newMessageIDs.map(id => ({ Message: { ItemId: { Id: id } } }));
      this.sentChanges = true;
      return { SyncState: "sync-2", IncludesLastItemInRange: "true", Changes: { Create: created } };
    }
    if (request.m$GetItem) {
      let ids = ensureArray(request.m$GetItem.m$ItemIds.t$ItemId).map((item: any) => item.Id);
      if (!request.m$GetItem.m$ItemShape.t$IncludeMimeContent) {
        return oneOrMany(ids.map(id => ({ Items: { Message: headersOfMessage(id) } })));
      }
      this.mimeRequests.push(ids);
      this.gotFirstMIMERequest.resolve();
      if (this.failMIMERequests) {
        throw new Error("The server is down");
      }
      if (this.blockFirstMIMERequest) {
        this.blockFirstMIMERequest = false;
        await this.answerFirstMIMERequest.promise;
      }
      return oneOrMany(ids.map(id => ({
        Items: { Message: { ItemId: { Id: id }, MimeContent: { Value: btoa(mimeOfMessage(id)) } } },
      })));
    }
    throw new Error("Unexpected EWS call " + JSON.stringify(request));
  }
}

/** `EWSAccount.checkResponse()` returns a single response message as an object */
function oneOrMany(responses: any[]): any {
  return responses.length == 1 ? responses[0] : responses;
}

let newMessageIDs = Array.from({ length: kNewMessages }, (_dummy, i) => "item-" + i);

function headersOfMessage(id: string) {
  return {
    ItemId: { Id: id },
    InternetMessageId: `<${id}@example.com>`,
    IsRead: "false",
    IsDraft: "false",
    Subject: "Subject of " + id,
    Size: "20000",
    DateTimeSent: kSent.toISOString(),
    DateTimeReceived: kReceived.toISOString(),
    From: { Mailbox: { EmailAddress: "alice@example.com", Name: "Alice" } },
    ToRecipients: { Mailbox: { EmailAddress: "user@example.com", Name: "User" } },
  };
}

function mimeOfMessage(id: string): string {
  return [
    `Message-ID: <${id}@example.com>`,
    "From: Alice <alice@example.com>",
    "To: User <user@example.com>",
    `Subject: Subject of ${id}`,
    "Date: " + kSent.toUTCString(),
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "The body of " + id + ".",
  ].join("\r\n");
}

async function setupAccountWithNewMail(): Promise<TestEWSAccount> {
  let tempDir = mkdtempSync(path.join(tmpdir(), "ews-download-test-"));
  appGlobal.remoteApp = {
    getSQLiteDatabase: (filename: string) =>
      new InProcessSQLiteDatabase(path.join(tempDir, filename)),
    getConfigDir: async () => tempDir,
    getFilesDir: async () => tempDir,
    path: { join: async (...parts: string[]) => path.join(...parts) },
    fs: { mkdir: async (dir: string) => mkdirSync(dir, { recursive: true }) },
  };
  let account = new TestEWSAccount();
  account.name = "Test";
  account.emailAddress = "user@example.com";
  account.storage = new SQLMailStorage();
  account.contentStorage.add(new SQLSourceEMail());
  let db = await getDatabase();
  let accountRow = await db.run(sql`
    INSERT INTO emailAccount (idStr, protocol) VALUES (${account.id}, ${account.protocol})`);
  account.dbID = accountRow.lastInsertRowid;
  let inbox = account.newFolder();
  inbox.name = "Inbox";
  inbox.id = "inbox-1";
  inbox.specialFolder = SpecialFolder.Inbox;
  inbox.syncState = "sync-1"; // we synced this folder before, 2 days ago
  account.rootFolders.add(inbox);
  await inbox.save();
  return account;
}

test("The new messages of the last 2 days are all downloaded", async () => {
  let account = await setupAccountWithNewMail();
  let inbox = account.inbox as EWSFolder;

  await inbox.getNewMessages();

  expect(inbox.messages.length).toBe(kNewMessages);
  let notDownloaded = inbox.messages.contents.filter(message => !message.downloadComplete);
  expect(notDownloaded.map(message => message.subject)).toEqual([]);
}, 30000);

test("Opening the folder fetches the mail that we listed, but never got", async () => {
  let account = await setupAccountWithNewMail();
  let inbox = account.inbox as EWSFolder;
  // The last app run listed the new mail, but the server did not give us the content
  account.errorCallback = () => undefined;
  account.failMIMERequests = true;
  await inbox.getNewMessages();
  expect(inbox.messages.contents.filter(message => message.downloadComplete)).toEqual([]);

  // The user starts the app again and opens the inbox. The server has nothing
  // new, so only the folder itself still tells us what we are missing.
  account.failMIMERequests = false;
  await inbox.getRecentMessages();

  let notDownloaded = inbox.messages.contents.filter(message => !message.downloadComplete);
  expect(notDownloaded.map(message => message.subject)).toEqual([]);
}, 30000);

test("Opening a message does not wait for the download that runs in the background", async () => {
  let account = await setupAccountWithNewMail();
  let inbox = account.inbox as EWSFolder;
  account.blockFirstMIMERequest = true;
  let downloading = inbox.getNewMessages();
  await account.gotFirstMIMERequest.promise;

  // The user opens a message that the batch which is still in flight will bring us.
  // He gets it now, in a request of its own, and does not wait for the other 9.
  let opened = inbox.messages.first as EWSEMail;
  await opened.loadMIME();

  expect(opened.downloadComplete).toBe(true);
  expect(account.mimeRequests.length).toBe(2); // the batch, and the message that he opened
  account.answerFirstMIMERequest.resolve();
  await downloading;
}, 30000);
