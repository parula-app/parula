import "../../../../../logic/app";
import { setupTestFolder } from "../../SQL/setup";
import { getPublicKeyByFingerprint } from "../../../../../logic/Mail/Encryption/KeyUtils";
import { TrustLevel } from "../../../../../logic/Mail/Encryption/enums";
import type { EMail } from "../../../../../logic/Mail/EMail";
import { kClearSigned, kOpaqueSigned, kECClearSigned } from "./signedMessages";
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
  let key = await getPublicKeyByFingerprint(email.signedPublicKeyFingerprint, email);
  if (!key || key.trustLevel == TrustLevel.Distrusted) {
    return null;
  }
  return key.name;
}

describe("Signature of a received message, without an own private key", () => {
  test("clear-signed message", async () => {
    let email = await readMessage(kClearSigned);
    expect(email.text.trim()).toBe("Hello, this is signed.");
    expect(await signedWithKeyName(email)).toBe(email.signedPublicKey.name);
  });

  test("opaque-signed message, as Outlook sends it", async () => {
    let email = await readMessage(kOpaqueSigned);
    expect(email.text.trim()).toBe("Hello, this is signed.");
    expect(await signedWithKeyName(email)).toBe(email.signedPublicKey.name);
  });

  test("clear-signed message, signed with an EC key", async () => {
    let email = await readMessage(kECClearSigned);
    expect(email.text.trim()).toBe("Hello, this is signed with an EC key.");
    expect(await signedWithKeyName(email)).toBeTruthy();
    // The certificate is kept for the sender
    expect(email.from.encryptionPublicKey?.userIDs.contents).toEqual(["ec256@example.com"]);
  });

  test("an unknown CA leaves the trust level to the user", async () => {
    let email = await readMessage(kClearSigned);
    let key = await getPublicKeyByFingerprint(email.signedPublicKeyFingerprint, email);
    expect(key.trustLevel).toBe(TrustLevel.Sender);
  });

  test("opaque-signed message, sent as a file (application/octet-stream, smime.p7m)", async () => {
    // Named only by the filename of the Content-Disposition
    let email = await readMessage(kOpaqueSigned.replace(`application/x-pkcs7-mime; smime-type=signed-data; name="smime.p7m"`, "application/octet-stream"));
    expect(email.text.trim()).toBe("Hello, this is signed.");
    expect(await signedWithKeyName(email)).toBe(email.signedPublicKey.name);
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
    expect(email.signedPublicKeyFingerprint).toBeFalsy();
    expect(new TextDecoder().decode(email.mime)).toBe(toCRLF(mime));
  });
});

/**
 * A forged mail from Alice that carries her real signed part and signature
 * from an earlier mail, but puts them where only our `multipart/signed`
 * splitter finds them, and other text where postal-mime finds it.
 * If the mail shows as signed by Alice, it must show what she signed.
 */
describe("Signed part that postal-mime doesn't find", () => {
  let headers = kClearSigned.split("\n\n")[0].split("\nContent-Type:")[0];
  // Alice's signed part and signature, from `kClearSigned`
  let body = kClearSigned.split("\n\n").slice(1).join("\n\n");
  let oldBoundary = "----3120AE5FA6844B38B313D9FF5848BBF0";
  let alicesParts = body.slice(body.indexOf("--" + oldBoundary));
  let signaturePart = alicesParts.slice(alicesParts.lastIndexOf("--" + oldBoundary + "\nContent-Type: application/x-pkcs7-signature"));
  signaturePart = signaturePart.slice(signaturePart.indexOf("\n") + 1, signaturePart.indexOf("\n--" + oldBoundary + "--"));
  let contentType = `Content-Type: multipart/signed; protocol="application/x-pkcs7-signature"; micalg="sha-256"`;

  /** Whatever shows as signed by Alice is what she signed */
  function expectSignedContent(email: EMail) {
    if (email.signedPublicKeyFingerprint) {
      expect(email.text).toContain("Hello, this is signed.");
      expect(email.text).not.toContain("OTHER TEXT");
      expect(email.html).not.toContain("OTHER TEXT");
    }
  }

  test("Alice's original mail is signed", async () => {
    let email = await readMessage(kClearSigned);
    expect(email.signedPublicKeyFingerprint).toBeTruthy();
  });

  test("Boundary with a quoted ;", async () => {
    let email = await readMessage(`${headers}
${contentType}; boundary="EVIL;X"

--EVIL;X
Content-Type: text/plain; charset=utf-8

OTHER TEXT
--EVIL;X
${signaturePart}
--EVIL;X--
${alicesParts.replaceAll(oldBoundary, '"EVIL')}`);
    expectSignedContent(email);
  });

  test("Boundary in RFC 2231 continuations, next to a plain one", async () => {
    let email = await readMessage(`${headers}
${contentType}; boundary="ORIG"; boundary*0="SHO"; boundary*1="WN"

--SHOWN
Content-Type: text/plain; charset=utf-8

OTHER TEXT
--SHOWN
${signaturePart}
--SHOWN--
${alicesParts.replaceAll(oldBoundary, "ORIG")}`);
    expectSignedContent(email);
  });

  test("Two Content-Type headers", async () => {
    let email = await readMessage(`${headers}
${contentType}; boundary="ORIG"
Content-Type: multipart/mixed; boundary="SHOWN"

--SHOWN
Content-Type: text/plain; charset=utf-8

OTHER TEXT
--SHOWN
${signaturePart}
--SHOWN--
${alicesParts.replaceAll(oldBoundary, "ORIG")}`);
    expectSignedContent(email);
  });

  test("Boundary lines with LF only, which only postal-mime splits on", async () => {
    let { folder } = await setupTestFolder();
    let email = folder.newEMail();
    email.mime = new TextEncoder().encode(toCRLF(`${headers}
${contentType}; boundary="B"
`) + `
--B
Content-Type: text/plain; charset=utf-8

OTHER TEXT
--B
${signaturePart}
--B--
` + toCRLF("\n" + alicesParts.replaceAll(oldBoundary, "B")));
    await email.parseMIME();
    expectSignedContent(email);
  });
});
