import "../../../../../logic/app";
import { setupTestFolder } from "../../SQL/setup";
import { appGlobal } from "../../../../../logic/app";
import { MailIdentity } from "../../../../../logic/Mail/MailIdentity";
import { PGPPrivateKey } from "../../../../../logic/Mail/Encryption/PGP/PGPPrivateKey";
import type { Folder } from "../../../../../logic/Mail/Folder";
import { expect, test, describe, beforeAll } from "vitest";

describe("Nested PGP layers", () => {
  const kHeaders = "From: Alice <alice@example.com>\r\n" +
    "To: User <user@example.com>\r\n" +
    "Subject: Nested\r\n" +
    "Date: Tue, 14 Jul 2026 10:00:00 +0000\r\n" +
    "Message-ID: <nested-pgp@example.com>\r\n" +
    "MIME-Version: 1.0\r\n";

  let folder: Folder;
  let key: PGPPrivateKey;

  beforeAll(async () => {
    ({ folder } = await setupTestFolder());
    let identity = new MailIdentity(folder.account);
    identity.emailAddress = "user@example.com";
    identity.realname = "User";
    folder.account.identities.add(identity);
    appGlobal.emailAccounts.add(folder.account);
    key = await PGPPrivateKey.createNewPrivateKey({ realname: "User", emailAddress: "user@example.com" });
    identity.encryptionPrivateKeys.add(key);
  });

  /** Encrypts the whole message to the user's public key, as PGP/MIME.
   * Anybody can do that, without any key of their own. */
  async function encrypted(mime: string): Promise<string> {
    let openPGP = await import("openpgp");
    let armored = await openPGP.encrypt({
      message: await openPGP.createMessage({ binary: new TextEncoder().encode(mime) }),
      encryptionKeys: await openPGP.readKey({ armoredKey: key.publicKeyArmored }),
      // Keeps the layers small, as an attacker would
      config: { preferredCompressionAlgorithm: openPGP.enums.compression.zlib },
    });
    return kHeaders +
      `Content-Type: multipart/encrypted; protocol="application/pgp-encrypted"; boundary="pgp"\r\n\r\n` +
      "--pgp\r\n" +
      "Content-Type: application/pgp-encrypted\r\n\r\n" +
      "Version: 1\r\n\r\n" +
      "--pgp\r\n" +
      `Content-Type: application/octet-stream; name="encrypted.asc"\r\n\r\n` +
      armored.replace(/\r?\n/g, "\r\n") + "\r\n" +
      "--pgp--\r\n";
  }

  async function read(layers: number): Promise<{ text: string, errors: Error[] }> {
    let errors: Error[] = [];
    folder.account.errorCallback = (ex) => errors.push(ex);
    let mime = kHeaders + "Content-Type: text/plain\r\n\r\nHello\r\n";
    for (let i = 0; i < layers; i++) {
      mime = await encrypted(mime);
    }
    let email = folder.newEMail();
    email.mime = new TextEncoder().encode(mime);
    await email.parseMIME();
    return { text: email.text?.trim(), errors };
  }

  test("A message encrypted twice is read", async () => {
    expect(await read(2)).toEqual({ text: "Hello", errors: [] });
  });

  test("Endless layers are not unwrapped, and that is reported", async () => {
    let { errors } = await read(25);
    expect(errors.length).toBeGreaterThan(0);
  });
});
