import { appGlobal } from "../../../../../logic/app";
import { SMIMEPublicKey, KeyStatus } from "../../../../../logic/Mail/Encryption/SMIME/SMIMEPublicKey";
import { SMIMEPrivateKey } from "../../../../../logic/Mail/Encryption/SMIME/SMIMEPrivateKey";
import { SignedData, Certificate } from "../../../../../logic/Mail/Encryption/SMIME/SMIMEASN1";
import { verifySignedData } from "../../../../../logic/Mail/Encryption/SMIME/SMIMEVerify";
import { TrustLevel, trustOrder } from "../../../../../logic/Mail/Encryption/enums";
import { kRootCA, kPathLen0CA, kAlice, kSubCA, kCarol, kNoCertSignCA, kBob, kMailCA, kTLSServer, kCEO, kOldCertificate, kDan, kGrace, kTLSCA, kHeidi, kTLSRootCA, kJudy, kExpiredRootCA, kIvan, kX509v1RootCA, kFrank, kSignedContent, kSignedByAlice, kSignedByErin, kECRootCA, kECCA, kOlivia, kOliviaKey, kRSACA, kPeggy, kSignedByPeggy } from "./certificateChains";
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

// `SMIMEPublicKey` caches the CA certificates per process,
// so this has to be the same for all tests in this file.
appGlobal.remoteApp = {
  async getCACertificates(type: string): Promise<string[]> {
    return type == "system" ? [kRootCA, kTLSRootCA, kExpiredRootCA, kX509v1RootCA, kECRootCA] : [];
  },
};

/** @param certificates The person's certificate, followed by its issuers, in PEM format */
async function expectNotTrusted(certificates: string) {
  let key = await SMIMEPublicKey.importPublicKey(certificates);
  expect(await key.keyStatus()).not.toBe(KeyStatus.Valid);
  expect(trustOrder(key.trustLevel)).toBeLessThanOrEqual(trustOrder(TrustLevel.Sender));
}

describe("Certificate chain", () => {
  test("from the root through a CA, which may not issue CA certificates, is trusted", async () => {
    let key = await SMIMEPublicKey.importPublicKey(kAlice + kPathLen0CA);
    expect(await key.keyStatus()).toBe(KeyStatus.Valid);
    expect(key.trustLevel).toBe(TrustLevel.OS);
  });

  test("through a TLS server certificate as issuer is not trusted", async () => {
    await expectNotTrusted(kCEO + kTLSServer + kMailCA);
  });

  test("through a certificate without extensions as issuer is not trusted", async () => {
    await expectNotTrusted(kDan + kOldCertificate + kMailCA);
  });

  test("through a CA certificate without keyCertSign is not trusted", async () => {
    await expectNotTrusted(kBob + kNoCertSignCA);
  });

  test("with more CA certificates than the pathlen of a CA allows is not trusted", async () => {
    await expectNotTrusted(kCarol + kSubCA + kPathLen0CA);
  });

  test("of a TLS server certificate is not trusted for email", async () => {
    await expectNotTrusted(kTLSServer + kMailCA);
  });

  // The Windows chain engine (Outlook) accepts it, Thunderbird and Apple Mail don't.
  // Only with `kAcceptAnyPurpose` in `allowsEMailProtection()`, which is off.
  test("of a certificate for any purpose is not trusted for email", async () => {
    await expectNotTrusted(kGrace + kMailCA);
  });

  test("through a CA for TLS server certificates is not trusted for email", async () => {
    await expectNotTrusted(kHeidi + kTLSCA);
  });

  test("to a root for TLS server certificates is not trusted for email", async () => {
    await expectNotTrusted(kJudy);
  });

  test("to an expired root is not trusted", async () => {
    await expectNotTrusted(kIvan);
  });

  // As in Windows (Outlook), Thunderbird and Apple Mail. `kAcceptX509v1Roots` in `keyStatus()`.
  // A version 1 certificate is still not trusted as issuer below the root, see above.
  test("to a version 1 root is trusted", async () => {
    let key = await SMIMEPublicKey.importPublicKey(kFrank);
    expect(await key.keyStatus()).toBe(KeyStatus.Valid);
    expect(key.trustLevel).toBe(TrustLevel.OS);
  });
});

describe("Certificate chain with EC keys", () => {
  test("of an RSA certificate, through an EC CA, to an EC root is trusted", async () => {
    let key = await SMIMEPublicKey.importPublicKey(kOlivia + kECCA);
    expect(await key.keyStatus()).toBe(KeyStatus.Valid);
    expect(key.trustLevel).toBe(TrustLevel.OS);
  });

  test("of an EC certificate, through an RSA CA, is trusted", async () => {
    let key = await SMIMEPublicKey.importPublicKey(kPeggy + kRSACA);
    expect(await key.keyStatus()).toBe(KeyStatus.Valid);
    expect(key.trustLevel).toBe(TrustLevel.OS);
  });

  test("with a changed certificate, which an EC CA signed, is invalid", async () => {
    let cert = Certificate.decodePEM(kOlivia, { label: "CERTIFICATE" });
    cert.tbsCertificate.serialNumber += 1n;
    let key = await SMIMEPublicKey.importPublicKey(Certificate.encodePEM(cert, { label: "CERTIFICATE" }) + kECCA);
    expect(await key.keyStatus()).toBe(KeyStatus.ChainInvalid);
  });

  test("of our own RSA key, through an EC CA, is trusted", async () => {
    let key = await SMIMEPrivateKey.importPrivateKey(kOliviaKey + kOlivia + kECCA);
    expect(key.userIDs.contents).toEqual(["olivia@example.com"]);
    expect(key.chain.contents.map(ca => ca.commonName)).toEqual(["Test EC CA"]);
    expect(await key.keyStatus()).toBe(KeyStatus.Valid);
  });
});

describe("Signature", () => {
  test("by a certificate from a trusted CA is trusted", async () => {
    let signer = await verifySignedData(SignedData.decodeFromBase64(kSignedByAlice), new TextEncoder().encode(kSignedContent));
    expect(signer?.trustLevel).toBe(TrustLevel.OS);
  });

  test("by an EC certificate from a trusted CA is trusted", async () => {
    let signer = await verifySignedData(SignedData.decodeFromBase64(kSignedByPeggy), new TextEncoder().encode(kSignedContent));
    expect(signer?.userIDs.contents).toEqual(["peggy@example.com"]);
    expect(signer?.trustLevel).toBe(TrustLevel.OS);
  });

  test("by a certificate that is only for encryption is not trusted", async () => {
    let signer = await verifySignedData(SignedData.decodeFromBase64(kSignedByErin), new TextEncoder().encode(kSignedContent));
    expect(trustOrder(signer?.trustLevel ?? TrustLevel.Sender)).toBeLessThanOrEqual(trustOrder(TrustLevel.Sender));
  });
});
