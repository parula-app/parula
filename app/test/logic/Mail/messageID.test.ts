// @vitest-environment happy-dom
import "../../frontend/Util/happyDOMForDOMPurify"; // `send()` converts the text to HTML
// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../logic/app";
import { newTestEMail, setUpAccount } from "./TestMailAccount";
import { CreateMIME } from "../../../logic/Mail/SMTP/CreateMIME";
import { SpecialFolder } from "../../../logic/Mail/Folder";
import { IMAPAccount } from "../../../logic/Mail/IMAP/IMAPAccount";
import { JMAPAccount } from "../../../logic/Mail/JMAP/JMAPAccount";
import { EWSAccount } from "../../../logic/Mail/EWS/EWSAccount";
import { OWAAccount } from "../../../logic/Mail/OWA/OWAAccount";
import { GraphAccount } from "../../../logic/Mail/Graph/GraphAccount";
import type { IMAPEMail } from "../../../logic/Mail/IMAP/IMAPEMail";
import type { JMAPEMail } from "../../../logic/Mail/JMAP/JMAPEMail";
import type { EWSEMail } from "../../../logic/Mail/EWS/EWSEMail";
import type { OWAEMail } from "../../../logic/Mail/OWA/OWAEMail";
import type { GraphEMail } from "../../../logic/Mail/Graph/GraphEMail";
import { findOrCreatePersonUID } from "../../../logic/Abstract/PersonUID";
import { expect, test } from "vitest";

test("The MIME of a composed email carries our Message-ID", async () => {
  let account = setUpAccount();
  let mail = newTestEMail(account);
  mail.text = "Draft";

  let nmMail = await CreateMIME.getNMMail(mail);

  // Saved drafts are found again by it, see `ComposeActions.getDrafts()`
  expect(mail.messageID).toBeTruthy();
  expect(nmMail.messageId).toBe(mail.messageID);
});

test("Saving a draft again finds the previous draft that the server listed with <>", async () => {
  let account = setUpAccount();
  let mail = newTestEMail(account);
  let drafts = account.getSpecialFolder(SpecialFolder.Drafts);
  let listed = drafts.newEMail();
  listed.mime = new TextEncoder().encode(`Message-ID: <${mail.messageID}>\r\nSubject: Hi\r\n\r\nDraft`);
  await listed.parseMIME();
  drafts.messages.add(listed);

  // `saveAsDraft()` deletes them
  expect(mail.compose.getDrafts().contents).toContain(listed);
});

/** A reply, as EWS and OWA get it from the server */
const kExchangeItem = {
  ItemId: { Id: "item-1" },
  ItemClass: "IPM.Note",
  IsRead: "false",
  InternetMessageId: "<reply@example.com>",
  InReplyTo: "<original@example.com>",
  References: "<start@example.com> <original@example.com>",
};

test("All protocols store the Message-IDs of the same email without <>, so that they find each other", async () => {
  appGlobal.remoteApp = { createIMAPFlowConnection: () => null, OWA: {}, kyCreate: () => null } as any;
  let imap =new IMAPAccount().newFolder().newEMail() as IMAPEMail;
  imap.fromFlow({ uid: 1, flags: new Set(), envelope: { messageId: "<reply@example.com>", inReplyTo: "<original@example.com>" } });
  let jmap = new JMAPAccount().newFolder().newEMail() as JMAPEMail;
  jmap.fromJMAP({ id: "1", keywords: {}, messageId: ["reply@example.com"], inReplyTo: ["original@example.com"] } as any);
  let ews = new EWSAccount().newFolder().newEMail() as EWSEMail;
  ews.fromXML(kExchangeItem);
  let owa = new OWAAccount().newFolder().newEMail() as OWAEMail;
  owa.fromJSON(kExchangeItem);
  let graph = new GraphAccount().newFolder().newEMail() as GraphEMail;
  graph.fromGraph({ id: "1", internetMessageId: "<reply@example.com>" } as any);
  graph.fromHeaders([{ name: "In-Reply-To", value: "<original@example.com>" }]);
  // ActiveSync, POP3 and .eml files have only the MIME source
  let mime = setUpAccount().getSpecialFolder(SpecialFolder.Inbox).newEMail();
  mime.mime = new TextEncoder().encode([
    "Message-ID: <reply@example.com>",
    "In-Reply-To: <original@example.com>",
    "References: <start@example.com>\r\n <original@example.com>",
    "From: Alice <alice@example.com>",
    "Subject: Re: Test",
    "",
    "Hello",
  ].join("\r\n"));
  await mime.parseMIME();

  for (let email of [imap, jmap, ews, owa, graph, mime]) {
    expect(email.messageID).toBe("reply@example.com");
    expect(email.inReplyTo).toBe("original@example.com");
  }
  for (let email of [ews, owa, mime]) {
    expect(email.references).toEqual(["start@example.com", "original@example.com"]);
  }
});

test("A reply that EWS sends has the In-Reply-To with <>", async () => {
  let account = new EWSAccount();
  let requests: any[] = [];
  account.callEWS = async (request: any) => requests.push(request);
  let folder = account.newFolder();
  folder.id = "sent";
  let reply = folder.newEMail();
  reply.from = findOrCreatePersonUID("me@example.com", "Me");
  reply.subject = "Re: Test";
  reply.text = "Hello";
  reply.inReplyTo = "original@example.com";

  await account.send(reply);

  expect(JSON.stringify(requests[0])).toContain("<original@example.com>");
});
