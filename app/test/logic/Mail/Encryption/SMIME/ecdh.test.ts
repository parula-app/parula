import "../../../../../logic/app";
import { setupTestFolder } from "../../SQL/setup";
import { appGlobal } from "../../../../../logic/app";
import { MailIdentity } from "../../../../../logic/Mail/MailIdentity";
import { SMIMEPrivateKey } from "../../../../../logic/Mail/Encryption/SMIME/SMIMEPrivateKey";
import { EnvelopedData } from "../../../../../logic/Mail/Encryption/SMIME/SMIMEASN1";
import type { Folder } from "../../../../../logic/Mail/Folder";
import type { EMail } from "../../../../../logic/Mail/EMail";
import { kOwnP256, kOwnP384, kOwnP521 } from "./ownECKeys";
import { kOpenSSLECDH, kOutlookECDH, kThunderbirdECDH, kECDHKeyID, kECDHSHA224, kECDH3DESWrap } from "./ecdhMessages";
import { expect, test, describe, beforeAll, beforeEach } from "vitest";

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

const kOwnKeys: Record<string, string> = { "P-256": kOwnP256, "P-384": kOwnP384, "P-521": kOwnP521 };

let folder: Folder;

beforeAll(async () => {
  ({ folder } = await setupTestFolder());
  appGlobal.emailAccounts.add(folder.account);
});

beforeEach(() => {
  folder.account.identities.clear();
});

describe("A message encrypted with ECDH to our EC key decrypts", () => {
  test.each(Object.keys(kOpenSSLECDH))("from OpenSSL, %s", async (name) => {
    await useKey(kOwnKeys[name.split(" ")[0]]);
    let { email, errors } = await read(kOpenSSLECDH[name]);
    expect(errors).toEqual([]);
    expect(email.text.trim()).toBe("Hello EC");
  });

  test("from Outlook, which sends the key wrap algorithm with NULL parameters and its key without the curve", async () => {
    await useKey(kOwnP256);
    let { email, errors } = await read(kOutlookECDH);
    expect(errors).toEqual([]);
    expect(email.text.trim()).toBe("Hello EC");
  });

  test("from Thunderbird, which adds a ukm", async () => {
    await useKey(kOwnP384);
    let { email, errors } = await read(kThunderbirdECDH);
    expect(errors).toEqual([]);
    expect(email.text.trim()).toBe("Hello EC");
  });

  test("for the subject key identifier of our certificate", async () => {
    await useKey(kOwnP256);
    let { email, errors } = await read(kECDHKeyID);
    expect(errors).toEqual([]);
    expect(email.text.trim()).toBe("Hello EC");
  });
});

describe("A message encrypted with ECDH to our EC key that we cannot decrypt tells the user why", () => {
  test("a KDF that we do not support", async () => {
    await useKey(kOwnP256);
    let { errors } = await read(kECDHSHA224);
    expect(errors).toEqual([expect.stringMatching(/sha224/i)]);
  });

  test("a key wrap algorithm that we do not support", async () => {
    await useKey(kOwnP256);
    let { errors } = await read(kECDH3DESWrap);
    expect(errors).toEqual([expect.stringMatching(/3DES/i)]);
  });

  test("a damaged encrypted key", async () => {
    await useKey(kOwnP256);
    let envelopedData = EnvelopedData.decode(base64ToBytes(kOutlookECDH));
    let kari = envelopedData.content.recipientInfos.find(recipientInfo => recipientInfo.type == "kari");
    kari.value.recipientEncryptedKeys[0].encryptedKey[5] ^= 1;
    let { errors } = await read(Buffer.from(EnvelopedData.encode(envelopedData)).toString("base64"));
    expect(errors).toEqual(["Could not decrypt this message"]);
  });
});

/** Our identity uses this key to decrypt and to sign */
async function useKey(pem: string) {
  let identity = new MailIdentity(folder.account);
  identity.emailAddress = "user@example.com";
  identity.encryptionPrivateKeys.add(await SMIMEPrivateKey.importPrivateKey(pem));
  folder.account.identities.add(identity);
}

/** Reads the CMS blob as an encrypted message
 * @returns the message and the errors that the user sees */
async function read(cms: string): Promise<{ email: EMail, errors: string[] }> {
  return await receive(`From: Alice <alice@example.com>
To: User <user@example.com>
Subject: Encrypted
Date: Tue, 14 Jul 2026 10:00:00 +0000
Message-ID: <ecdh@example.com>
MIME-Version: 1.0
Content-Disposition: attachment; filename="smime.p7m"
Content-Type: application/pkcs7-mime; smime-type=enveloped-data; name="smime.p7m"
Content-Transfer-Encoding: base64

${cms}
`.replace(/\n/g, "\r\n"));
}

async function receive(mime: string): Promise<{ email: EMail, errors: string[] }> {
  let errors: string[] = [];
  folder.account.errorCallback = (ex) => errors.push(ex.message);
  let email = folder.newEMail();
  email.mime = new TextEncoder().encode(mime);
  await email.parseMIME();
  return { email, errors };
}

function base64ToBytes(base64: string): Uint8Array {
  return new Uint8Array(Buffer.from(base64, "base64"));
}
