import { appGlobal } from "../../../../logic/app";
import { JMAPAccount } from "../../../../logic/Mail/JMAP/JMAPAccount";
import type { JMAPFolder } from "../../../../logic/Mail/JMAP/JMAPFolder";
import type { JMAPEMail } from "../../../../logic/Mail/JMAP/JMAPEMail";
import { DummyMailStorage } from "../../../../logic/Mail/Store/DummyMailStorage";
import type { TJMAPMethodResponse, TJMAPSession } from "../../../../logic/Mail/JMAP/TJMAPGeneric";
import { expect, test } from "vitest";

appGlobal.remoteApp ??= { kyCreate: () => null } as any;

/** An email as Stalwart returns it from `Email/get` without `properties` */
const kStalwartEMail = {
  id: "iaaaaac", blobId: "catyxccs031m7s9mogshetv11im3aa3zmdcvfchfzlxhwik7en0w2byaai", threadId: "c",
  mailboxIds: { a: true }, keywords: { "$seen": true, "$flagged": true }, size: 260, receivedAt: "2026-10-17T15:52:44Z",
  messageId: ["m-mvcks7bq-39@example.org"], inReplyTo: null, references: null, sender: null,
  from: [{ name: "Outside", email: "outside@example.org" }], to: [{ name: null, email: "mail-carol@example.com" }],
  cc: null, bcc: null, replyTo: null, subject: "carol-mvcks7bq-816", sentAt: "2026-10-17T15:52:44Z",
  hasAttachment: false, preview: "Hello carol-mvcks7bq-816\n", bodyValues: {},
  textBody: [{ partId: "0", blobId: "cetyxccs031m7s9mogshetv11im3aa3zmdcvfchfzlxhwik7en0w2byaalvacgq", size: 26, name: null, type: "text/plain", charset: "utf-8", disposition: null, cid: null, language: null, location: null }],
  htmlBody: [{ partId: "0", blobId: "cetyxccs031m7s9mogshetv11im3aa3zmdcvfchfzlxhwik7en0w2byaalvacgq", size: 26, name: null, type: "text/plain", charset: "utf-8", disposition: null, cid: null, language: null, location: null }],
  attachments: [],
};

test("The email list fetches only the properties that we use, and they are enough", async () => {
  let account = new JMAPAccount();
  account.accountID = "h";
  account.session = { capabilities: {}, accounts: {}, primaryAccounts: {} } as any as TJMAPSession;
  account.storage = new DummyMailStorage();
  let requestedProperties: string[][] = [];
  account.makeCalls = async (requests: [string, Record<string, any>, string?][]) => requests.map(([method, args, callID]) => {
    if (method == "Email/query") {
      return [method, { accountId: "h", queryState: "saq", canCalculateChanges: true, position: 0, ids: ["iaaaaac"], total: 1 }, callID];
    }
    requestedProperties.push(args.properties);
    let email = args.properties
      ? Object.fromEntries(Object.entries(kStalwartEMail).filter(([key]) => args.properties.includes(key)))
      : kStalwartEMail;
    return [method, { accountId: "h", state: "saq", list: [email], notFound: [] }, callID];
  }) as TJMAPMethodResponse[];
  let inbox = account.newFolder() as JMAPFolder;
  inbox.id = "a";
  inbox.countTotal = 1;
  account.rootFolders.add(inbox);

  await inbox.listMessages();

  expect(requestedProperties[0]).toContain("mailboxIds");
  expect(requestedProperties[0]).not.toContain("textBody");
  expect(requestedProperties[0]).not.toContain("bodyValues");
  let email = inbox.messages.first as JMAPEMail;
  expect(email.subject).toBe("carol-mvcks7bq-816");
  expect(email.messageID).toBe("m-mvcks7bq-39@example.org");
  expect(email.from.emailAddress).toBe("outside@example.org");
  expect(email.to.contents.map(person => person.emailAddress)).toEqual(["mail-carol@example.com"]);
  expect([email.isRead, email.isStarred]).toEqual([true, true]);
  expect(email.threadID).toBe("c");
  expect(email.size).toBe(260);
  expect(email.mimeBlobId).toBe(kStalwartEMail.blobId);
  expect(email.received.toISOString()).toBe("2026-10-17T15:52:44.000Z");
});
