import { appGlobal } from "../../../../../logic/app";
import { SMIMEPublicKey, KeyStatus } from "../../../../../logic/Mail/Encryption/SMIME/SMIMEPublicKey";
import { SignedData, Certificate, ECDSASigValue, Oid } from "../../../../../logic/Mail/Encryption/SMIME/SMIMEASN1";
import { verifySignedData } from "../../../../../logic/Mail/Encryption/SMIME/SMIMEVerify";
import { importPublicKey, readPublicKeyFile } from "../../../../../logic/Mail/Encryption/KeyUtils";
import { base64ToBytes } from "../../../../../../lib/asn1/decoders/pem";
import { kECSignedContent, kP256Certificate, kP256CertificateP7B, kSignedP256, kSignedP256SHA1, kSignedP256NoAttributes, kSignedP384, kSignedP521, kSignedSecp256k1, kExplicitCurveCertificate, kSignedExplicitCurve } from "./ellipticCurves";
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

// No CA is trusted. The certificates here are self-signed.
appGlobal.remoteApp = {
  async getCACertificates(): Promise<string[]> {
    return [];
  },
};

async function verify(signedData: any, content = kECSignedContent): Promise<SMIMEPublicKey | null> {
  return await verifySignedData(signedData, new TextEncoder().encode(content));
}

/** The signed data of `kSignedP256`, with the signature values changed by `change` */
function changedSignature(change: (sig: ECDSASigValue) => ECDSASigValue): any {
  let signedData = SignedData.decodeFromBase64(kSignedP256);
  let signerInfo = signedData.content.signerInfos[0];
  signerInfo.signature = ECDSASigValue.encode(change(ECDSASigValue.decode(signerInfo.signature)));
  return signedData;
}

describe("Signature with an EC key", () => {
  test.each([
    ["P-256 with SHA-256", kSignedP256, "ec256@example.com"],
    ["P-384 with SHA-384", kSignedP384, "ec384@example.com"],
    ["P-521 with SHA-512", kSignedP521, "ec521@example.com"],
    // Outlook signs signed and encrypted mail with ecdsa-with-SHA1
    ["P-256 with SHA-1", kSignedP256SHA1, "ec256@example.com"],
    ["P-256, without signed attributes", kSignedP256NoAttributes, "ec256@example.com"],
  ])("%s verifies", async (name, signature, emailAddress) => {
    let signer = await verify(SignedData.decodeFromBase64(signature));
    expect(signer?.userIDs.contents).toEqual([emailAddress]);
  });

  // RFC 5753 section 2: signers may write the key algorithm instead of ecdsa-with-SHA256
  test("with id-ecPublicKey as signature algorithm verifies", async () => {
    let signedData = SignedData.decodeFromBase64(kSignedP256);
    signedData.content.signerInfos[0].signatureAlgorithm = { algorithm: "ecPublicKey" };
    expect(await verify(signedData)).not.toBeNull();
  });

  test("labelled as RSA signature is rejected", async () => {
    let signedData = SignedData.decodeFromBase64(kSignedP256);
    signedData.content.signerInfos[0].signatureAlgorithm = { algorithm: "sha256WithRSAEncryption" };
    expect(await verify(signedData)).toBeNull();
  });

  test("over changed content is rejected", async () => {
    expect(await verify(SignedData.decodeFromBase64(kSignedP256), "Hello, this is changed.\r\n")).toBeNull();
  });

  test("that was changed is rejected", async () => {
    expect(await verify(changedSignature(({ r, s }) => ({ r, s: s ^ 1n })))).toBeNull();
  });

  // The order of the group of P-256. r + n is the same modulo n, but longer than the curve.
  const kP256Order = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551n;
  test.each([
    ["r longer than the curve", ({ r, s }) => ({ r: r + kP256Order, s })],
    ["s longer than the curve", ({ r, s }) => ({ r, s: s + kP256Order })],
    ["negative r", ({ r, s }) => ({ r: -r, s })],
  ])("with %s is rejected", async (name, change: (sig: ECDSASigValue) => ECDSASigValue) => {
    expect(await verify(changedSignature(change))).toBeNull();
  });

  test.each([
    ["the curve secp256k1, which WebCrypto does not have", kSignedSecp256k1],
    ["explicit curve parameters", kSignedExplicitCurve],
  ])("with %s shows as unsigned, without an error", async (name, signature) => {
    expect(await verify(SignedData.decodeFromBase64(signature))).toBeNull();
  });

  test("with missing curve parameters shows as unsigned, without an error", async () => {
    let signedData = SignedData.decodeFromBase64(kSignedP256);
    delete signedData.content.certificates[0].tbsCertificate.publicKey.algorithmIdentifier.parameters;
    expect(await verify(signedData)).toBeNull();
  });
});

function der(pem: string): Uint8Array {
  return base64ToBytes(pem.replace(/-----[A-Z0-9 ]+-----|\s/g, ""));
}

describe("EC certificate of a contact", () => {
  test.each([
    ["PEM", new File([kP256Certificate], "ec256.pem")],
    ["DER", new File([der(kP256Certificate)], "ec256.cer")],
    ["PKCS#7", new File([kP256CertificateP7B], "ec256.p7b")],
  ])("in a %s file is added", async (name, file) => {
    let key = await importPublicKey(await readPublicKeyFile(file)) as SMIMEPublicKey;
    expect(key).toBeInstanceOf(SMIMEPublicKey);
    expect(key.userIDs.contents).toEqual(["ec256@example.com"]);
    expect(key.cipher).not.toBe("RSA");
    expect(key.keyLengthInBits).toBe(256);
    expect(await key.keyStatus()).toBe(KeyStatus.SelfSignedRoot);
  });

  test("gets the same key ID as the signer of a mail with that certificate", async () => {
    let key = await SMIMEPublicKey.importPublicKey(kP256Certificate);
    let signer = await verify(SignedData.decodeFromBase64(kSignedP256));
    expect(signer?.id).toBe(key.id);
  });

  // Anybody can write the curve point of somebody else's key into a certificate for another curve
  test("gets another key ID than a certificate with the same curve point on another curve", async () => {
    let key = await SMIMEPublicKey.importPublicKey(kP256Certificate);
    let cert = Certificate.decodePEM(kP256Certificate, { label: "CERTIFICATE" });
    cert.tbsCertificate.publicKey.algorithmIdentifier.parameters = Oid.encode("secp384r1");
    let fake = await SMIMEPublicKey.importPublicKey(Certificate.encodePEM(cert, { label: "CERTIFICATE" }));
    expect(fake.id).not.toBe(key.id);
  });

  test("with explicit curve parameters is added, but not confirmed", async () => {
    let key = await SMIMEPublicKey.importPublicKey(kExplicitCurveCertificate);
    expect(key.userIDs.contents).toEqual(["ecexplicit@example.com"]);
    expect(await key.keyStatus()).toBe(KeyStatus.ChainIncomplete);
  });
});
