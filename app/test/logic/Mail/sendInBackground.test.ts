// @vitest-environment happy-dom
// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../logic/app";
import { newTestEMail, setUpAccount } from "./TestMailAccount";
import { SpecialFolder } from "../../../logic/Mail/Folder";
import { gLicense } from "../../../logic/util/License";
import { beforeAll, expect, test } from "vitest";

/* The test mails have no HTML body: `send()` runs the body through
 * `convertHTMLToText()`, and DOMPurify with `WHOLE_DOCUMENT` throws
 * "Only one element on document allowed" on happy-dom, for any input.
 * For the same reason, we pretend to be licensed, so that `send()` does not
 * add the Parula footer to the body. */
beforeAll(() => gLicense.license = { valid: true });

test("Composer can close while the mail is still being sent", async () => {
  let account = setUpAccount();
  let mail = newTestEMail(account);
  let sentFolder = account.getSpecialFolder(SpecialFolder.Sent);

  let composerClosed = false;
  let sent = mail.compose.send(() => composerClosed = true);
  await account.atServer;

  expect(composerClosed).toBe(true);
  expect(mail.isSending).toBe(true);
  // Newest first, so at the top, where the user sees it
  expect(sentFolder.messages.contents[0]).toBe(mail);
  expect(mail.outgoing).toBe(true);
  expect(mail.isDraft).toBe(false);

  account.serverAccepts();
  await sent;

  expect(mail.isSending).toBe(false);
  expect(sentFolder.messages.contents).not.toContain(mail);
});

test("Mail that the server refused disappears from the Sent folder again", async () => {
  let account = setUpAccount();
  let mail = newTestEMail(account);
  let sentFolder = account.getSpecialFolder(SpecialFolder.Sent);

  let sent = mail.compose.send();
  await account.atServer;
  account.serverRefuses(new Error("Mailbox full"));

  await expect(sent).rejects.toThrow("Mailbox full");
  expect(mail.isSending).toBe(false);
  expect(sentFolder.messages.contents).not.toContain(mail);
});

test("Errors that the user must fix are thrown before the composer closes", async () => {
  let account = setUpAccount();
  let mail = newTestEMail(account);
  mail.identity.emailAddress = "*@example.com"; // catch-all
  mail.from.emailAddress = "*@example.com";

  let composerClosed = false;
  await expect(mail.compose.send(() => composerClosed = true))
    .rejects.toThrow(/catch-all/);
  expect(composerClosed).toBe(false);
  expect(mail.isSending).toBe(false);
  expect(account.getSpecialFolder(SpecialFolder.Sent).messages.contents).not.toContain(mail);
});
