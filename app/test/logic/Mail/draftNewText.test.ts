// @vitest-environment happy-dom
// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../logic/app";
import { newTestEMail, setUpAccount, type TestMailAccount } from "./TestMailAccount";
import { CreateMIME } from "../../../logic/Mail/SMTP/CreateMIME";
import { SpecialFolder } from "../../../logic/Mail/Folder";
import { gLicense } from "../../../logic/util/License";
import type { EMail } from "../../../logic/Mail/EMail";
import { beforeAll, beforeEach, expect, test, vi } from "vitest";

// DOMPurify doesn't work on happy-dom, and `send()` needs its `DOMParser`
vi.mock("../../../logic/util/convertHTML", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../logic/util/convertHTML")>(),
  convertHTMLToText: (html: string) => html.replace(/<[^>]*>/g, ""),
}));

/** The MIME source of the drafts that the server got */
let onServer: string[] = [];
let account: TestMailAccount;

beforeAll(() => {
  gLicense.license = { valid: true }; // no Parula footer in sent mails
  appGlobal.remoteApp = {
    // Stands in for nodemailer in the backend
    getMIMENodemailer: async (mail: any) => new TextEncoder().encode(
      `Message-ID: <${mail.messageId}>\r\nSubject: ${mail.subject}\r\n\r\n${mail.text}\r\n\r\n${mail.html}`),
  };
});

beforeEach(() => {
  onServer = [];
  account = setUpAccount();
  // What the protocol implementations do
  account.getSpecialFolder(SpecialFolder.Drafts).addMessage = async (message: EMail) => {
    message.mime ??= await CreateMIME.getMIME(message);
    onServer.push(new TextDecoder().decode(message.mime));
  };
});

function newMail(html: string): EMail {
  let mail = newTestEMail(account);
  mail.html = html;
  return mail;
}

test("Saving a draft again saves the new text", async () => {
  let mail = newMail("<p>See you at noon</p>");
  await mail.compose.saveAsDraft();
  mail.html = "<p>See you at one</p>";
  await mail.compose.saveAsDraft();
  expect(onServer.length).toBe(2);
  expect(onServer[1]).toContain("See you at one");
  expect(onServer[1]).not.toContain("noon");
});

test("A draft that the user opened from the server is saved with the new text", async () => {
  await newMail("<p>See you at noon</p>").compose.saveAsDraft();
  let opened = account.getSpecialFolder(SpecialFolder.Drafts).newEMail();
  opened.mime = new TextEncoder().encode(onServer[0]);
  await opened.parseMIME(); // as `editDraft()` loads it
  opened.identity = account.identities.first;
  opened.html = "<p>See you at one</p>"; // what the user wrote in the composer
  await opened.compose.saveAsDraft();
  expect(onServer.length).toBe(2);
  expect(onServer[1]).toContain("See you at one");
  expect(onServer[1]).not.toContain("noon");
});

test("Sending a mail that was saved as draft before sends the new text", async () => {
  let mail = newMail("<p>See you at noon</p>");
  await mail.compose.saveAsDraft();
  mail.html = "<p>See you at one</p>";
  let sent = mail.compose.send();
  await account.atServer;
  // The protocols upload `mail.mime`, if it's set
  let uploaded = new TextDecoder().decode(mail.mime ?? await CreateMIME.getMIME(mail));
  account.serverAccepts();
  await sent;
  expect(uploaded).toContain("See you at one");
  expect(uploaded).not.toContain("noon");
});
