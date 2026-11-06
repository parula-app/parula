import "../../../../../logic/app";
import { setupTestFolder } from "../../SQL/setup";
import { appGlobal } from "../../../../../logic/app";
import { MailIdentity } from "../../../../../logic/Mail/MailIdentity";
import { findOrCreatePersonUID } from "../../../../../logic/Abstract/PersonUID";
import { PGPSend } from "../../../../../logic/Mail/Encryption/PGP/PGPSend";
import { PGPPrivateKey } from "../../../../../logic/Mail/Encryption/PGP/PGPPrivateKey";
import { PGPPublicKey } from "../../../../../logic/Mail/Encryption/PGP/PGPPublicKey";
import type { EMail } from "../../../../../logic/Mail/EMail";
import type { Folder } from "../../../../../logic/Mail/Folder";
import { expect, test, beforeAll } from "vitest";

let folder: Folder;
let identity: MailIdentity;
let key: PGPPrivateKey;
/** What nodemailer creates. It becomes the signed and encrypted message. */
let innerMIME: string;

beforeAll(async () => {
  ({ folder } = await setupTestFolder({
    getMIMENodemailer: async () => new TextEncoder().encode(innerMIME.replace(/\n/g, "\r\n")),
  }));
  identity = new MailIdentity(folder.account);
  identity.emailAddress = "signer@example.com";
  identity.realname = "Signer";
  folder.account.identities.add(identity);
  appGlobal.emailAccounts.add(folder.account);
  key = await PGPPrivateKey.createNewPrivateKey({ realname: "Signer", emailAddress: "signer@example.com" });
  identity.encryptionPrivateKeys.add(key);
  findOrCreatePersonUID("signer@example.com", "Signer").encryptionPublicKey =
    await PGPPublicKey.importPublicKey(key.publicKeyArmored);
});

/** Signs with our key and encrypts to ourselves. The outer `From:` is ours,
 * so the reader finds our key and the signature verifies.
 * @param innerFrom `From:` of the signed message inside */
async function sendAndReceive(innerFrom: string): Promise<EMail> {
  innerMIME = kMIME.replace("From: Signer <signer@example.com>", `From: ${innerFrom}`);
  let mail = folder.newEMail();
  mail.identity = identity;
  mail.from = findOrCreatePersonUID("signer@example.com", "Signer");
  mail.to.add(mail.from);
  mail.signedByKeyID = key.id;
  mail.shouldEncrypt = true;
  let sent = (await PGPSend.encryptAndSign(mail)).sendRawMIME;
  // The outer headers are not signed, so anybody can put anything there
  sent = sent.replace(/^From: .*$/m, "From: Signer <signer@example.com>");

  let email = folder.newEMail();
  email.mime = new TextEncoder().encode(sent);
  await email.parseMIME();
  return email;
}

test("PGP: Encrypted message whose signed From: is the outer From: is signed", async () => {
  let email = await sendAndReceive("Signer <signer@example.com>");
  expect(email.wasEncrypted).toBe(true);
  expect(email.signedByKeyID).toBe(key.id);
});

test("PGP: Encrypted message whose signed From: is another address is not signed", async () => {
  let email = await sendAndReceive("CEO <ceo@example.com>");
  expect(email.wasEncrypted).toBe(true);
  // The reader shows the From: of the decrypted message
  expect(email.from.emailAddress).toBe("ceo@example.com");
  expect(email.signedByKeyID).toBe(null);
  expect(email.signedKey).toBe(null);
});

const kMIME = `From: Signer <signer@example.com>
To: Signer <signer@example.com>
Subject: Signed and encrypted
Message-ID: <pgp-signed-from@example.com>
Date: Tue, 14 Jul 2026 10:00:00 +0000
MIME-Version: 1.0
Content-Type: text/plain; charset=utf-8

Hello
`;
