// @vitest-environment happy-dom
// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { GraphAccount } from "../../../../logic/Mail/Graph/GraphAccount";
import { GraphFolder } from "../../../../logic/Mail/Graph/GraphFolder";
import { findOrCreatePersonUID } from "../../../../logic/Abstract/PersonUID";
import type { EMail } from "../../../../logic/Mail/EMail";
import { expect, test } from "vitest";

test("Sending an email gives the Bcc recipients to the server", async () => {
  let { account, sent } = setUpAccount();
  let email = newEMail(account);

  await account.send(email);

  let headers = sent[0].split("\r\n\r\n")[0];
  expect(headers).toMatch(/^Bcc:.*bob@example\.com/im);
  expect(headers).toContain("carol@example.com");
});

test("Sending an encrypted email gives the Bcc recipients to the server", async () => {
  let { account, sent } = setUpAccount();
  let email = newEMail(account);
  email.sendRawMIME = "From: alice@example.com\r\nTo: carol@example.com\r\nContent-Type: application/pkcs7-mime\r\n\r\nENCRYPTED\r\n";

  await account.send(email);

  let headers = sent[0].split("\r\n\r\n")[0];
  expect(headers).toMatch(/^Bcc:.*bob@example\.com/im);
  expect(sent[0]).toContain("ENCRYPTED");
});

function newEMail(account: GraphAccount): EMail {
  let email = new GraphFolder(account).newEMail();
  email.from = findOrCreatePersonUID("alice@example.com", "Alice");
  email.to.add(findOrCreatePersonUID("carol@example.com", "Carol"));
  email.bcc.add(findOrCreatePersonUID("bob@example.com", "Bob"));
  email.subject = "Hello";
  email.text = "Hello Carol";
  return email;
}

/** @returns sent The MIME of the emails that we sent, as the server got them */
function setUpAccount() {
  let sent: string[] = [];
  appGlobal.remoteApp = {
    kyCreate: () => ({
      post: (url: string, options: any) => {
        expect(url).toContain("/sendMail");
        sent.push(atob(options.body));
        return {};
      },
    }),
    // Stands in for nodemailer in the backend, which writes no Bcc header
    getMIMENodemailer: async (mail: any) => new TextEncoder().encode(mail.raw ??
      `From: Alice <alice@example.com>\r\nTo: Carol <carol@example.com>\r\nSubject: ${mail.subject}\r\n\r\n${mail.text}\r\n`),
  };
  let account = new GraphAccount();
  account.name = "Test";
  account.emailAddress = "alice@example.com";
  account.url = "https://graph.microsoft.com";
  account.oAuth2 = { isLoggedIn: true, authorizationHeader: "Bearer TEST" } as any;
  return { account, sent };
}
