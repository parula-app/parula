import "../../../../../logic/app";
import { setupTestFolder } from "../../SQL/setup";
import { appGlobal } from "../../../../../logic/app";
import { MailIdentity } from "../../../../../logic/Mail/MailIdentity";
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
