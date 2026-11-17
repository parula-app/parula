// @vitest-environment happy-dom
// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../logic/app";
import { setUpAccount } from "./TestMailAccount";
import { SpecialFolder } from "../../../logic/Mail/Folder";
import { PersonUID } from "../../../logic/Abstract/PersonUID";
import { expect, test } from "vitest";

/* A sender controls his display name, the subject and the Message-ID.
 * All 3 end up in the quote header that we put into the composer and then send. */
const kInjection = `<img src=q onerror=alert(1)>`;

function newHostileMail() {
  let account = setUpAccount();
  let inbox = account.getSpecialFolder(SpecialFolder.Inbox);
  let mail = inbox.newEMail();
  mail.from = new PersonUID("bob@example.com", "Bob " + kInjection);
  mail.subject = "Invoice " + kInjection;
  mail.id = `x" onmouseover="alert(1)`;
  mail.sent = mail.received = new Date();
  mail.html = "<p>body</p>";
  return mail;
}

test("Reply does not let the sender inject HTML into the quote header", async () => {
  let reply = newHostileMail().compose.replyToAuthor();

  expect(reply.rawHTMLDangerous).not.toContain(kInjection);
  expect(reply.rawHTMLDangerous).toContain("&lt;img src=q onerror=alert(1)&gt;");
  // The Message-ID must not break out of the `cite` attribute
  expect(reply.rawHTMLDangerous).toContain(`cite="mid:x&quot; onmouseover=&quot;alert(1)"`);
});

test("Forward does not let the sender inject HTML into the forward header", async () => {
  let forward = await newHostileMail().compose.forwardInline();

  expect(forward.rawHTMLDangerous).not.toContain(kInjection);
  expect(forward.rawHTMLDangerous).toContain("&lt;img src=q onerror=alert(1)&gt;");
  // The `<>` around the address are text, not a tag that the parser swallows
  expect(forward.rawHTMLDangerous).toContain("&lt;bob@example.com&gt;");
});
