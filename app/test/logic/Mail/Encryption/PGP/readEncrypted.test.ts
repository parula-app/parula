import "../../../../../logic/app";
import { setupTestFolder } from "../../SQL/setup";
import { appGlobal } from "../../../../../logic/app";
import { MailIdentity } from "../../../../../logic/Mail/MailIdentity";
import { PGPPrivateKey } from "../../../../../logic/Mail/Encryption/PGP/PGPPrivateKey";
import { MailAccount } from "../../../../../logic/Mail/MailAccount";
import { Folder } from "../../../../../logic/Mail/Folder";
import type { EMail } from "../../../../../logic/Mail/EMail";
import type { Collection } from "svelte-collections";
import { expect, test } from "vitest";

test("An encrypted message that is not for us tells the user why it stays empty", async () => {
  let { folder } = await setupTestFolder();
  let identity = new MailIdentity(folder.account);
  identity.emailAddress = "user@example.com";
  identity.realname = "User";
  folder.account.identities.add(identity);
  appGlobal.emailAccounts.add(folder.account);
  let errors: Error[] = [];
  folder.account.errorCallback = (ex) => errors.push(ex);

  let email = folder.newEMail();
  email.mime = new TextEncoder().encode(kPGPEncrypted.replace(/\n/g, "\r\n"));
  await email.parseMIME();

  expect(email.subject).toBe("PGP encrypted test");
  expect(errors.map(ex => ex.message)).toEqual(["This message is encrypted, and the key is not available"]);
});

test("Opening an encrypted message for another key than ours shows the error instead of an empty body", async () => {
  let { folder } = await setupTestFolder();
  let identity = new MailIdentity(folder.account);
  identity.emailAddress = "user@example.com";
  identity.realname = "User";
  identity.encryptionPrivateKeys.add(await PGPPrivateKey.createNewPrivateKey({ realname: "User", emailAddress: "user@example.com" }));
  folder.account.identities.add(identity);
  appGlobal.emailAccounts.replaceAll([folder.account]);

  let email = folder.newEMail();
  email.download = async () => { // as the protocols do
    email.mime = new TextEncoder().encode(kPGPEncrypted.replace(/\n/g, "\r\n"));
    await email.parseMIME();
  };
  await email.loadBody();
  expect(email.html).toMatch(/decrypt/i);
});

/** A PGP mail encrypted to us, decrypted, with its original source on the server */
async function decryptedMail(folder: Folder): Promise<{ email: EMail, original: Uint8Array }> {
  let identity = new MailIdentity(folder.account);
  identity.emailAddress = "user@example.com";
  identity.realname = "User";
  let key = await PGPPrivateKey.createNewPrivateKey({ realname: "User", emailAddress: "user@example.com" });
  identity.encryptionPrivateKeys.add(key);
  folder.account.identities.add(identity);
  appGlobal.emailAccounts.replaceAll([folder.account]);
  let openPGP = await import("openpgp");
  let armored = await openPGP.encrypt({
    message: await openPGP.createMessage({ text: "Content-Type: text/plain\r\n\r\nThe secret body\r\n" }),
    encryptionKeys: await openPGP.readKey({ armoredKey: key.publicKeyArmored }),
  });
  let original = new TextEncoder().encode("From: Bob <bob@example.com>\r\n" +
    "To: User <user@example.com>\r\n" +
    "Subject: PGP encrypted test\r\n" +
    "MIME-Version: 1.0\r\n" +
    `Content-Type: multipart/encrypted; protocol="application/pgp-encrypted"; boundary="pgp"\r\n\r\n` +
    "--pgp\r\n" +
    "Content-Type: application/pgp-encrypted\r\n\r\n" +
    "Version: 1\r\n\r\n" +
    "--pgp\r\n" +
    `Content-Type: application/octet-stream; name="encrypted.asc"\r\n\r\n` +
    armored.replace(/\r?\n/g, "\r\n") + "\r\n" +
    "--pgp--\r\n");

  let email = folder.newEMail();
  email.mime = original;
  email.downloadMIME = async () => original; // the server
  await email.parseMIME();
  expect(email.text.trim()).toBe("The secret body");
  return { email, original };
}

test("Copying an encrypted message to another account uploads it still encrypted, and keeps our decrypted copy", async () => {
  let { folder } = await setupTestFolder();
  let { email } = await decryptedMail(folder);

  let uploaded: EMail;
  let otherAccount = new Folder(new MailAccount());
  otherAccount.addMessage = async (message: EMail) => {
    uploaded = message;
  };
  await otherAccount.copyMessageHere(email);

  let uploadedText = new TextDecoder().decode(uploaded.mime);
  expect(uploadedText).toContain("BEGIN PGP MESSAGE");
  expect(uploadedText).not.toContain("secret body");
  expect(uploaded.text).not.toContain("secret body"); // e.g. for a protocol that uploads the properties
  expect(new TextDecoder().decode(email.mime)).toContain("secret body");
  expect(email.text).toContain("secret body");
});

test("Copying an encrypted message on the same server gives the server only the encrypted original", async () => {
  let { folder } = await setupTestFolder();
  let { email, original } = await decryptedMail(folder);
  email.pID = 1234;

  let onServer: EMail;
  let sameAccount = new Folder(folder.account);
  // As a protocol that uploads the message for a copy on the server
  (sameAccount as any).moveOrCopyMessagesOnServer = async (action: string, messages: Collection<EMail>) => {
    onServer = messages.first;
  };
  await sameAccount.copyMessageHere(email);

  expect(onServer.pID).toBe(email.pID);
  expect(onServer.mime).toEqual(original);
  expect(onServer.text).not.toContain("secret body");
  expect(onServer.attachments.isEmpty).toBe(true);
  expect(email.text).toContain("secret body");
});

/** `gpg --encrypt`, to a key that is not ours */
const kPGPEncrypted = `From: Bob <bob@example.com>
To: User <user@example.com>
Subject: PGP encrypted test
Date: Thu, 03 Sep 2026 01:23:47 GMT
Message-ID: <enc-pgp@example.com>
MIME-Version: 1.0
Content-Type: multipart/encrypted; protocol="application/pgp-encrypted"; boundary="----=_Part_PGP_2"

------=_Part_PGP_2
Content-Type: application/pgp-encrypted
Content-Description: PGP/MIME version identification

Version: 1

------=_Part_PGP_2
Content-Type: application/octet-stream; name="encrypted.asc"
Content-Disposition: inline; filename="encrypted.asc"
Content-Description: OpenPGP encrypted message

-----BEGIN PGP MESSAGE-----

hQEMA6oMLC7z099YAQgAj5ULwWDhv7CR/zm6BOj3lS1v9SDHH1ksKJs9xtvwTTSJ
2S1I8UOsqplZGEEnPxxrMFzzt4fjmPEtNIjFNhtpNm53SlvezAs+m8IsCCyhme/G
FYQsQhERE2l9HoruFVuEB0GRKGRv9ERYDmjknsRKRCHYYTPK2WeyFh+lgbPR7++I
0KkCXcLw6fqPD2qR0rDOaNGPEIP7Sh9b7LZ5cDUFw5IhxK4OODRNSIBydxiIZOqf
ekl4TxmDcXL89TRk/kgwWIFPnqbjHBlR+T+lFVBn9jF5FJAwg4JxkqeF4ejb9lJ8
s8/geleN+K1kUht+lk3wWKtO4ypxaM6YmzuMtnuyBNJ/Abbt0sqpJ8VD9PeZ8wiA
51BxPeN06tUec/QBTFcAVZESSgB1AzU+atkZf+gwbZs4trzxhtv9oI6VlynyzrNc
MmiEFEDbkKxqSeM/ycPHH2cw0/gUcMGg5kyavSpOz1io8qi+4y6e4EFmsT5O1w4y
I2JK+cDmNH1X3ssJyGjjvQ==
=Ji6B
-----END PGP MESSAGE-----

------=_Part_PGP_2--
`;
