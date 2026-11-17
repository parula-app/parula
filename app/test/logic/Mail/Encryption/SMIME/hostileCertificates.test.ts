// The key classes use the app singleton. Importing it first breaks the
// import cycle, which would otherwise leave the base classes undefined.
import { appGlobal } from "../../../../../logic/app";
import { Attributes, BasicConstraints, Certificate, DigestInfo, Null, OctetString, Oid, PrivateKeyInfo, RSAPrivateKey, RSAPublicKey, SignedData, TBSCertificate, UTCTime } from "../../../../../logic/Mail/Encryption/SMIME/SMIMEASN1";
import { SMIMEPublicKey, KeyStatus } from "../../../../../logic/Mail/Encryption/SMIME/SMIMEPublicKey";
import { verifySignedData } from "../../../../../logic/Mail/Encryption/SMIME/SMIMEVerify";
import { encrypt, decrypt, padFF } from "../../../../../logic/Mail/Encryption/SMIME/SMIMERSAES";
import { berToDER } from "../../../../../../lib/asn1/ber";
import { setupTestFolder } from "../../SQL/setup";
import { expect, test, describe } from "vitest";

/* Certificates and CMS blobs reach us from attackers: signed and encrypted
 * mails, the company directory, files. These tests craft them in ways that
 * no honest certificate authority or mail app would. */

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

// No CA vouches for the crafted certificates.
appGlobal.remoteApp ??= {
  async getCACertificates(type: string): Promise<string[]> {
    return [];
  },
};

async function generateRSAKey(): Promise<RSAPrivateKey> {
  let { privateKey } = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: Uint8Array.of(1, 0, 1), hash: "SHA-256" },
    true, ["sign"]);
  let privateKeyInfo = PrivateKeyInfo.decode(new Uint8Array(await crypto.subtle.exportKey("pkcs8", privateKey)));
  return RSAPrivateKey.decode(privateKeyInfo.privateKey);
}

/** A public key for certificates that nobody signs with */
function fakePublicKey(i = 0): RSAPublicKey {
  return { n: (1n << 2047n) + BigInt(2 * i + 1), e: 65537n };
}

function name(commonName: string): any {
  return [{ type: "CN", value: { type: "utf8str", value: commonName } }];
}

/** @returns the certificate as our decoder reads it, with an invalid signature */
function craftCertificate(subject: string, issuer: string, key: RSAPublicKey): Certificate {
  let cert = {
    tbsCertificate: {
      version: 2n,
      serialNumber: 1n,
      signature: { algorithm: "sha256WithRSAEncryption", parameters: Null.encode() },
      issuer: name(issuer),
      validity: {
        notBefore: { type: "utctime", value: Date.UTC(2026, 0, 1) },
        notAfter: { type: "gentime", value: Date.UTC(2099, 0, 1) },
      },
      subject: name(subject),
      publicKey: {
        algorithmIdentifier: { algorithm: "rsaEncryption", parameters: Null.encode() },
        subjectPublicKey: { unused: 0, data: RSAPublicKey.encode(key) },
      },
    },
    signatureAlgorithm: { algorithm: "sha256WithRSAEncryption", parameters: Null.encode() },
    signatureValue: { unused: 0, data: new Uint8Array(1) },
  } as any as Certificate;
  return Certificate.decode(Certificate.encode(cert));
}

function concat(first: Uint8Array, second: Uint8Array): Uint8Array {
  let result = new Uint8Array(first.length + second.length);
  result.set(first);
  result.set(second, first.length);
  return result;
}

/** RSASSA-PKCS1-v1_5 signature, optionally with the flaws of a forged one:
 * parameters other than NULL, or bytes after the DigestInfo. A forger with
 * a key with public exponent 3 hides the freedom that he needs there. */
async function sign(data: Uint8Array, key: RSAPrivateKey, parameters = Null.encode(), trailing = new Uint8Array()): Promise<Uint8Array> {
  let digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data as BufferSource));
  let digestInfo = DigestInfo.encode({ digestAlgorithm: { algorithm: "sha256", parameters }, digest });
  return decrypt(padFF(concat(digestInfo, trailing), key), key);
}

async function signCertificate(cert: Certificate, key: RSAPrivateKey, parameters?: Uint8Array): Promise<Certificate> {
  cert.signatureValue = { unused: 0, data: await sign(TBSCertificate.encode(cert.tbsCertificate), key, parameters) };
  return Certificate.decode(Certificate.encode(cert));
}

describe("ASN.1 decoder", () => {
  test("A length that does not fit into 31 bits does not make it loop forever", () => {
    // SEQUENCE with indefinite length, holding an INTEGER of length 0xFFFFFFFA
    let rsaPublicKey = Uint8Array.of(0x30, 0x80, 0x02, 0x84, 0xFF, 0xFF, 0xFF, 0xFA, 0, 0);
    expect(() => RSAPublicKey.decode(rsaPublicKey)).toThrow();
  });

  test("Each value in a SET OF holds only its own bytes", () => {
    let attributes = Attributes.encode([{ attrType: "contentType", attrValue: [Null.encode(), Null.encode(), Null.encode()] }]);
    let values = Attributes.decode(attributes)[0].attrValue;
    expect(values.map(value => Array.from(value))).toEqual([[5, 0], [5, 0], [5, 0]]);
  });

  test("A huge INTEGER is rejected, because decoding it would take minutes", () => {
    let huge = 100000;
    let modulus = new Uint8Array(5 + huge).fill(0x5A);
    modulus.set([0x02, 0x83, huge >> 16, huge >> 8 & 0xFF, huge & 0xFF]);
    let content = concat(modulus, Uint8Array.of(0x02, 0x01, 0x03));
    let rsaPublicKey = concat(Uint8Array.of(0x30, 0x83, content.length >> 16, content.length >> 8 & 0xFF, content.length & 0xFF), content);
    expect(() => RSAPublicKey.decode(rsaPublicKey)).toThrow();
  });

  test("The largest RSA keys that other apps accept still work", () => {
    let key = { n: (1n << 16383n) + 1n, e: 65537n };
    expect(RSAPublicKey.decode(RSAPublicKey.encode(key))).toEqual(key);
  });

  test("Deeply nested BER is rejected", () => {
    let depth = 1000;
    let ber = new Uint8Array(depth * 4 + 2);
    for (let i = 0; i < depth; i++) {
      ber.set([0x30, 0x80], i * 2);
    }
    ber.set([0x05, 0x00], depth * 2); // NULL, followed by the end-of-contents octets
    expect(() => berToDER(ber)).toThrow();
  });

  test("UTCTime with a year from 50 to 99 is in the 20th century, RFC 5280 section 4.1.2.5.1", () => {
    let utcTime = (time: string) => new Date(UTCTime.decode(Uint8Array.of(0x17, time.length, ...new TextEncoder().encode(time))));
    expect(utcTime("650101000000Z").getUTCFullYear()).toBe(1965);
    expect(utcTime("490101000000Z").getUTCFullYear()).toBe(2049);
  });
});

describe("RSA", () => {
  test("A modulus larger than other apps accept is refused, because the check would take minutes", () => {
    let key = { n: (1n << 16400n) - 1n, e: 65537n };
    expect(() => encrypt(new Uint8Array(2050), key)).toThrow();
  });

  test("A public exponent larger than other apps accept is refused", () => {
    let key = { n: (1n << 2047n) + 1n, e: (1n << 64n) + 1n };
    expect(() => encrypt(new Uint8Array(256), key)).toThrow();
  });
});

describe("Signature", () => {
  let content = new TextEncoder().encode("Content-Type: text/plain\r\n\r\nPay 100 EUR to Alice\r\n");

  async function signedData(signature: Uint8Array, cert: Certificate): Promise<any> {
    return {
      content: {
        certificates: [cert],
        signerInfos: [{
          version: 1n,
          sid: { type: "issuerAndSerialNumber", value: { issuer: cert.tbsCertificate.issuer, serialNumber: cert.tbsCertificate.serialNumber } },
          digestAlgorithm: { algorithm: "sha256" },
          signatureAlgorithm: { algorithm: "rsaEncryption" },
          signature,
        }],
      },
    };
  }

  test("of a mail verifies only with the exact PKCS #1 block", async () => {
    let key = await generateRSAKey();
    let cert = craftCertificate("Alice", "Alice", key);
    let valid = await signedData(await sign(content, key), cert);
    expect(await verifySignedData(valid, content)).not.toBeNull();
    let trailing = await signedData(await sign(content, key, Null.encode(), Uint8Array.of(1, 2, 3)), cert);
    expect(await verifySignedData(trailing, content)).toBeNull();
    let parameters = await signedData(await sign(content, key, OctetString.encode(Uint8Array.of(1, 2, 3))), cert);
    expect(await verifySignedData(parameters, content)).toBeNull();
  });

  test("made for another type of content is not taken for a mail, RFC 5652 section 5.3", async () => {
    let key = await generateRSAKey();
    let cert = craftCertificate("Alice", "Alice", key);
    let messageDigest = new Uint8Array(await crypto.subtle.digest("SHA-256", content));
    // The content type in the signed attributes is the signer's, the eContentType is the attacker's
    async function signedFor(contentType: string | number[] | null, eContentType: string | number[] = "data"): Promise<any> {
      let signedAttrs = [{ attrType: "messageDigest", attrValue: [OctetString.encode(messageDigest)] }];
      if (contentType) {
        signedAttrs.unshift({ attrType: "contentType", attrValue: [Oid.encode(contentType as any)] });
      }
      let signed = await signedData(await sign(Attributes.encode(signedAttrs), key), cert);
      signed.content.contentInfo = { contentType: eContentType };
      signed.content.signerInfos[0].signedAttrs = signedAttrs;
      return signed;
    }
    expect(await verifySignedData(await signedFor("data"), content)).not.toBeNull();
    // A signed receipt (RFC 2634), which the recipient of a mail signs and sends back
    let receipt = [1, 2, 840, 113549, 1, 9, 16, 1, 1];
    expect(await verifySignedData(await signedFor(receipt), content)).toBeNull();
    // In multipart/signed, the attacker writes the whole SignedData, so also the eContentType
    expect(await verifySignedData(await signedFor(receipt, receipt), content)).toBeNull();
    expect(await verifySignedData(await signedFor(null), content)).toBeNull();
  });

  test("of a CA verifies only with the exact PKCS #1 block", async () => {
    let caKey = await generateRSAKey();
    let caCertificate = craftCertificate("CA", "CA", caKey);
    caCertificate.tbsCertificate.extensions = [{ extnID: "basicConstraints", critical: true, extnValue: BasicConstraints.encode({ cA: true }) }];
    let ca = await signCertificate(caCertificate, caKey);
    async function keyStatus(leaf: Certificate): Promise<KeyStatus> {
      let key = new SMIMEPublicKey();
      await key.addCertificate(leaf);
      await key.addCertificate(ca);
      return await key.keyStatus();
    }
    let valid = await signCertificate(craftCertificate("Alice", "CA", fakePublicKey()), caKey);
    expect(await keyStatus(valid)).toBe(KeyStatus.SelfSignedRoot);
    let forged = await signCertificate(craftCertificate("Alice", "CA", fakePublicKey()), caKey, OctetString.encode(Uint8Array.of(1, 2, 3)));
    expect(await keyStatus(forged)).toBe(KeyStatus.ChainInvalid);
  });
});

describe("Certificate", () => {
  test("A chain longer than other apps check is not read", async () => {
    let key = new SMIMEPublicKey();
    await expect((async () => {
      for (let i = 0; i < 50; i++) {
        await key.addCertificate(craftCertificate("CA " + i, "CA " + (i + 1), fakePublicKey(i)));
      }
    })()).rejects.toThrow();
    expect(key.chain.length).toBeLessThanOrEqual(8);
  });

  test("Another key whose modulus ends in the same digits has another key ID", async () => {
    let alice = await SMIMEPublicKey.importPublicKey(Certificate.encodePEM(craftCertificate("Alice", "Alice", fakePublicKey()), { label: "CERTIFICATE" }));
    let lookalike = fakePublicKey();
    lookalike.n += 12345n << 64n;
    let mallory = await SMIMEPublicKey.importPublicKey(Certificate.encodePEM(craftCertificate("Mallory", "Mallory", lookalike), { label: "CERTIFICATE" }));
    expect(mallory.id).not.toBe(alice.id);
  });

  test("A renewed certificate for the same key keeps the key ID", async () => {
    let first = await SMIMEPublicKey.importPublicKey(Certificate.encodePEM(craftCertificate("Alice", "CA 1", fakePublicKey()), { label: "CERTIFICATE" }));
    let renewed = await SMIMEPublicKey.importPublicKey(Certificate.encodePEM(craftCertificate("Alice", "CA 2", fakePublicKey()), { label: "CERTIFICATE" }));
    expect(renewed.id).toBe(first.id);
  });

  test("A stored key gets the key ID of its certificate", async () => {
    let key = await SMIMEPublicKey.importPublicKey(Certificate.encodePEM(craftCertificate("Alice", "Alice", fakePublicKey()), { label: "CERTIFICATE" }));
    let json = key.toJSON();
    json.id = "0123456789abcdef";
    let stored = new SMIMEPublicKey();
    stored.fromJSON(json);
    expect(stored.id).toBe(key.id);
  });

  test("The name shows no control or direction characters, and is not endless", async () => {
    let commonName = "Alice‮moc.live@\u0000​" + "x".repeat(1000);
    let key = await SMIMEPublicKey.importPublicKey(Certificate.encodePEM(craftCertificate(commonName, "Alice", fakePublicKey()), { label: "CERTIFICATE" }));
    expect(key.commonName.startsWith("Alice")).toBe(true);
    expect(key.commonName).not.toMatch(/[\u0000-\u001F​‮]/);
    expect(key.commonName.length).toBeLessThanOrEqual(64);
  });
});

describe("Nested S/MIME layers", () => {
  const kHeaders = "From: Alice <alice@example.com>\r\n" +
    "To: User <user@example.com>\r\n" +
    "Subject: Nested\r\n" +
    "Date: Tue, 14 Jul 2026 10:00:00 +0000\r\n" +
    "Message-ID: <nested@example.com>\r\n" +
    "MIME-Version: 1.0\r\n";

  /** Wraps the MIME entity into an opaque-signed one, without a signer */
  function opaqueSigned(mime: string): string {
    let blob = SignedData.encode({
      contentType: "signedData",
      content: {
        version: 1n,
        digestAlgorithms: [],
        contentInfo: { contentType: "data", content: OctetString.encode(new TextEncoder().encode(mime)) },
        signerInfos: [],
      },
    });
    return "Content-Type: application/pkcs7-mime; smime-type=signed-data; name=smime.p7m\r\n" +
      "Content-Transfer-Encoding: base64\r\n\r\n" +
      Buffer.from(blob).toString("base64").replace(/.{76}/g, "$&\r\n") + "\r\n";
  }

  async function read(layers: number, times = 1): Promise<{ text: string, errors: Error[] }> {
    let { folder } = await setupTestFolder({ getCACertificates: async () => [] });
    let errors: Error[] = [];
    folder.account.errorCallback = (ex) => errors.push(ex);
    let mime = "Content-Type: text/plain\r\n\r\nHello\r\n";
    for (let i = 0; i < layers; i++) {
      mime = opaqueSigned(mime);
    }
    let email = folder.newEMail();
    for (let i = 0; i < times; i++) {
      // Unwrapping replaced the source, so give it the original again, as a new download would
      email.mime = new TextEncoder().encode(kHeaders + mime);
      await email.parseMIME();
    }
    return { text: email.text?.trim(), errors };
  }

  test("Signed, encrypted and signed again, as RFC 8551 allows, are all read", async () => {
    expect(await read(3)).toEqual({ text: "Hello", errors: [] });
  });

  test("Endless layers are not unwrapped, and that is reported", async () => {
    let { errors } = await read(25);
    expect(errors.length).toBeGreaterThan(0);
  });

  test("The same message read again and again unwraps all layers each time", async () => {
    expect(await read(3, 5)).toEqual({ text: "Hello", errors: [] });
  });
});
