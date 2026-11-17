// @vitest-environment happy-dom
// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../logic/app";
import { setUpAccount, type TestMailAccount } from "./TestMailAccount";
import type { EMail } from "../../../logic/Mail/EMail";
import { PersonUID } from "../../../logic/Abstract/PersonUID";
import { gLicense } from "../../../logic/util/License";
import { beforeAll, expect, test } from "vitest";

/* Replies and forwards have an HTML body, and `send()` sanitizes it with
 * DOMPurify, which throws on happy-dom for any input. So the mails go out as
 * plaintext, and we pretend to be licensed, to avoid the Parula footer. */
beforeAll(() => gLicense.license = { valid: true });

test("Reply that the user discarded does not mark the original as replied", () => {
  let account = setUpAccount();
  let original = newIncomingEMail(account);

  original.compose.replyToAuthor(); // discarded, never sent

  expect(original.isReplied).toBe(false);
});

test("Original is marked as replied only after the reply was sent", async () => {
  let account = setUpAccount();
  let original = newIncomingEMail(account);

  let reply = original.compose.replyToAuthor();
  expect(original.isReplied).toBe(false);

  await sendAndAccept(reply, account);

  expect(original.isReplied).toBe(true);
});

test("Reply that the server refused does not mark the original as replied", async () => {
  let account = setUpAccount();
  let original = newIncomingEMail(account);
  let reply = original.compose.replyToAuthor();
  reply.text = "My reply";

  let sent = reply.compose.send();
  await account.atServer;
  account.serverRefuses(new Error("Mailbox full"));

  await expect(sent).rejects.toThrow("Mailbox full");
  expect(original.isReplied).toBe(false);
});

test("Forward that the user discarded does not mark the original as forwarded", async () => {
  let account = setUpAccount();
  let original = newIncomingEMail(account);

  await original.compose.forwardInline(); // discarded, never sent

  expect(original.isForwarded).toBe(false);
});

test("Original is marked as forwarded only after the forward was sent", async () => {
  let account = setUpAccount();
  let original = newIncomingEMail(account);

  let forward = await original.compose.forwardInline();
  // The composer sets these from its From: and To: fields
  forward.identity = account.identities.first;
  forward.to.add(new PersonUID("somebody@example.com", "Somebody"));
  expect(original.isForwarded).toBe(false);

  await sendAndAccept(forward, account);

  expect(original.isForwarded).toBe(true);
});

/** A mail from somebody else, in our inbox */
function newIncomingEMail(account: TestMailAccount): EMail {
  let mail = account.inbox.newEMail();
  mail.from = new PersonUID("you@example.com", "You");
  mail.subject = "Hi";
  mail.sent = mail.received = new Date();
  account.inbox.messages.add(mail);
  return mail;
}

async function sendAndAccept(mail: EMail, account: TestMailAccount): Promise<void> {
  mail.text = "My message"; // Drops the HTML body, see top of file
  let sent = mail.compose.send();
  await account.atServer;
  account.serverAccepts();
  await sent;
}
