import "../../../../../logic/app";
import { setupTestFolder } from "../../SQL/setup";
import { getPublicKeyByKeyID } from "../../../../../logic/Mail/Encryption/KeyUtils";
import { TrustLevel } from "../../../../../logic/Mail/Encryption/enums";
import type { EMail } from "../../../../../logic/Mail/EMail";
import { kClearSigned, kOpaqueSigned } from "./signedMessages";
import { expect, test, describe } from "vitest";

// The browser has this, but Node does not.
globalThis.indexedDB ??= {
  cmp(a: Uint8Array, b: Uint8Array): number {
    let length = Math.min(a.length, b.length);
    for (let i = 0; i < length; i++) {
      if (a[i] != b[i]) {
        return a[i] < b[i] ? -1 : 1;
      }
    }
    return Math.sign(a.length - b.length);
  },
} as any;

/**
 * Reads the message, with an account that has no private key at all,
 * and the sender not in the addressbook. The signer certificate travels
 * with the message, so the signature must verify nonetheless.
 *
 * `getCACertificates` throws, as on mobile and webmail, whose backends do
 * not implement it. Only the trust level depends on it, so the signature
 * must survive. `SMIMEPublicKey` caches the CA certificates per process,
 * so this has to be the same for all tests in this file.
 */
async function readMessage(mime: string): Promise<EMail> {
  let { folder } = await setupTestFolder({
    getCACertificates: async () => {
      throw new Error("getCACertificates is not a function");
    },
  });
  let email = folder.newEMail();
  email.mime = new TextEncoder().encode(toCRLF(mime));
  await email.parseMIME();
  return email;
}

function toCRLF(mime: string): string {
  return mime.replace(/\n/g, "\r\n");
}

/** What the message reader shows the signature for */
async function signedWithKeyName(email: EMail): Promise<string | null> {
  let key = await getPublicKeyByKeyID(email.signedByKeyID, email);
  if (!key || key.trustLevel == TrustLevel.Distrusted) {
    return null;
  }
  return key.name;
}

describe("Signature of a received message, without an own private key", () => {
  test("clear-signed message", async () => {
    let email = await readMessage(kClearSigned);
    expect(email.text.trim()).toBe("Hello, this is signed.");
    expect(await signedWithKeyName(email)).toBe(email.signedKey.name);
  });

  test("opaque-signed message, as Outlook sends it", async () => {
    let email = await readMessage(kOpaqueSigned);
    expect(email.text.trim()).toBe("Hello, this is signed.");
    expect(await signedWithKeyName(email)).toBe(email.signedKey.name);
  });

  test("an unknown CA leaves the trust level to the user", async () => {
    let email = await readMessage(kClearSigned);
    let key = await getPublicKeyByKeyID(email.signedByKeyID, email);
    expect(key.trustLevel).toBe(TrustLevel.Sender);
  });

  test("opaque-signed message, sent as a file (application/octet-stream, smime.p7m)", async () => {
    // Named only by the filename of the Content-Disposition
    let email = await readMessage(kOpaqueSigned.replace(`application/x-pkcs7-mime; smime-type=signed-data; name="smime.p7m"`, "application/octet-stream"));
    expect(email.text.trim()).toBe("Hello, this is signed.");
    expect(await signedWithKeyName(email)).toBe(email.signedKey.name);
  });

  test("a mail with an attached signed file (.p7m) stays as it is", async () => {
    // Like an Italian e-invoice, which is signed XML. Here, the CMS blob of `kOpaqueSigned`.
    let signedFile = kOpaqueSigned.split("\n\n")[1];
    let mime = `From: Alice <alice@example.com>
To: User <user@example.com>
Subject: Invoice
Date: Tue, 14 Jul 2026 10:00:00 +0000
Message-ID: <invoice@example.com>
MIME-Version: 1.0
Content-Type: multipart/mixed; boundary="invoice"

--invoice
Content-Type: text/plain; charset=utf-8

Please find the invoice attached.
--invoice
Content-Type: application/octet-stream; name="IT01234567890_FPA01.xml.p7m"
Content-Disposition: attachment; filename="IT01234567890_FPA01.xml.p7m"
Content-Transfer-Encoding: base64

${signedFile}
--invoice--
`;
    let email = await readMessage(mime);
    expect(email.text.trim()).toBe("Please find the invoice attached.");
    expect(email.attachments.contents.map(attachment => attachment.filename)).toEqual(["IT01234567890_FPA01.xml.p7m"]);
    expect(email.signedByKeyID).toBeFalsy();
    expect(new TextDecoder().decode(email.mime)).toBe(toCRLF(mime));
  });
});
