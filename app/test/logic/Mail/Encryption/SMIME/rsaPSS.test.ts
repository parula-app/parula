import { appGlobal } from "../../../../../logic/app";
import { SMIMEPublicKey, KeyStatus } from "../../../../../logic/Mail/Encryption/SMIME/SMIMEPublicKey";
import { Certificate, RSASSAPSSParams, AlgorithmIdentifier, SignedData } from "../../../../../logic/Mail/Encryption/SMIME/SMIMEASN1";
import { verifySignedData } from "../../../../../logic/Mail/Encryption/SMIME/SMIMEVerify";
import { TrustLevel } from "../../../../../logic/Mail/Encryption/enums";
import { kSignedContent } from "./certificateChains";
import { kPSSRootCA, kPSSCA, kPeggy, kQuentin, kSybil, kPSSOnlyCA, kRupert, kSignedByPeggy } from "./rsaPSSSignatures";
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
    return type == "system" ? [kPSSRootCA] : [];
  },
};

/** @param certificates The person's certificate, followed by its issuers, in PEM format */
async function keyStatus(certificates: string): Promise<KeyStatus> {
  let key = await SMIMEPublicKey.importPublicKey(certificates);
  return await key.keyStatus();
}

async function verify(signedData: any, content = kSignedContent): Promise<SMIMEPublicKey | null> {
  return await verifySignedData(signedData, new TextEncoder().encode(content));
}

/** The certificate, changed by `change`, in PEM format */
function changedCertificate(pem: string, change: (cert: Certificate) => void): string {
  let cert = Certificate.decodePEM(pem, { label: "CERTIFICATE" });
  change(cert);
  return Certificate.encodePEM(cert, { label: "CERTIFICATE" });
}

/** Changes the PSS parameters of the signature of the certificate */
function changePSSParameters(change: (params: RSASSAPSSParams) => void): (cert: Certificate) => void {
  return cert => {
    let params = RSASSAPSSParams.decode(cert.signatureAlgorithm.parameters);
    change(params);
    cert.signatureAlgorithm.parameters = RSASSAPSSParams.encode(params);
  };
}

describe("Certificate chain signed with RSA-PSS", () => {
  test("with SHA-256 is trusted", async () => {
    let key = await SMIMEPublicKey.importPublicKey(kPeggy + kPSSCA);
    expect(await key.keyStatus()).toBe(KeyStatus.Valid);
    expect(key.trustLevel).toBe(TrustLevel.OS);
    expect(key.caName).toBe("PSS Test Root CA");
  });

  // Each of these first checks that the unchanged certificate is trusted,
  // so that it is the change that breaks the chain.
  test.each([
    ["a changed certificate", kPeggy, (cert: Certificate) => cert.tbsCertificate.serialNumber++],
    ["a changed salt length", kPeggy, changePSSParameters(params => params.saltLength = 20n)],
    ["a changed hash for the mask", kPeggy, changePSSParameters(params => params.maskGenAlgorithm.parameters = AlgorithmIdentifier.encode({ algorithm: "sha1" }))],
    ["a trailer field other than 1", kPeggy, changePSSParameters(params => params.trailerField = 2n)],
    // RFC 4055 section 3.1: they must be there, even if they are all defaults
    ["no parameters", kSybil, (cert: Certificate) => cert.signatureAlgorithm = { algorithm: "rsassaPss" } as AlgorithmIdentifier],
  ])("with %s is not trusted", async (name, pem, change) => {
    expect(await keyStatus(pem + kPSSCA)).toBe(KeyStatus.Valid);
    expect(await keyStatus(changedCertificate(pem, change) + kPSSCA)).toBe(KeyStatus.ChainInvalid);
  });

  // WebCrypto uses the same hash for the mask. No CA is known to sign like this.
  test("signed with another hash for the mask than for the signature is not trusted", async () => {
    expect(await keyStatus(kPeggy + kPSSCA)).toBe(KeyStatus.Valid);
    expect(await keyStatus(kQuentin + kPSSCA)).toBe(KeyStatus.ChainInvalid);
  });

  // The RFC 4055 defaults. SHA-1 is accepted as with PKCS #1 v1.5 padding.
  test("with SHA-1 and the default parameters is trusted", async () => {
    expect(await keyStatus(kSybil + kPSSCA)).toBe(KeyStatus.Valid);
  });

  test("by a CA whose key is only for PSS is trusted", async () => {
    expect(await keyStatus(kRupert + kPSSOnlyCA)).toBe(KeyStatus.Valid);
  });

  test("of a mail signature with PKCS #1 v1.5 padding is trusted", async () => {
    let signer = await verify(SignedData.decodeFromBase64(kSignedByPeggy));
    expect(signer?.userIDs.contents).toEqual(["peggy@example.com"]);
    expect(signer?.trustLevel).toBe(TrustLevel.OS);
  });
});
