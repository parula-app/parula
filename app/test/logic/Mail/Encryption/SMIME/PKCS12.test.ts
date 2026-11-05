import { expect, test, describe } from "vitest";
import { PKCS12 } from "../../../../../logic/Mail/Encryption/SMIME/PKCS12";
import { SMIMEPrivateKey } from "../../../../../logic/Mail/Encryption/SMIME/SMIMEPrivateKey";
import { readPrivateKeyFile } from "../../../../../logic/Mail/Encryption/KeyUtils";
import { Certificate, PrivateKeyInfo, RSAPrivateKey, RSAPublicKey } from "../../../../../logic/Mail/Encryption/SMIME/SMIMEASN1";
import { base64ToBytes } from "../../../../../../lib/asn1/decoders/pem";

// The browser has these, but Node does not.
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
 * All fixtures below contain the same 1024 bit key and certificate for
 * `test@example.com`, and were made with `openssl pkcs12 -export`,
 * each with the ciphers that one of the common exporters uses.
 */
const kPassphrase = "secret";
const kEmailAddress = "test@example.com";

async function readFixture(fixture: string, passphrase = kPassphrase): Promise<PKCS12> {
  let p12 = new PKCS12(passphrase);
  await p12.read(base64ToBytes(fixture.replace(/\s/g, "")));
  return p12;
}

/** Checks that we really decrypted the key: a key that came out wrong
 * would be neither a valid RSA key nor the one in the certificate. */
function expectKeyOfCertificate(p12: PKCS12) {
  expect(p12.keys.length).toBe(1);
  let key = RSAPrivateKey.decode(PrivateKeyInfo.decode(p12.keys[0]).privateKey);
  expect(key.n).toBe(key.p * key.q);
  let certificate = Certificate.decode(p12.certificates[0]);
  let publicKey = RSAPublicKey.decode(certificate.tbsCertificate.publicKey.subjectPublicKey.data);
  expect(key.n).toBe(publicKey.n);
  expect(key.e).toBe(publicKey.e);
}

describe("PKCS#12 import", () => {
  test("AES, as OpenSSL 3 and current apps write it", async () => {
    let p12 = await readFixture(kAESFixture);
    expect(p12.certificates.length).toBe(1);
    expectKeyOfCertificate(p12);
  });

  test("PBES2 with Triple DES, which WebCrypto cannot decrypt", async () => {
    let p12 = await readFixture(kPBES2TripleDESFixture);
    expectKeyOfCertificate(p12);
  });

  test("40 bit RC2 and Triple DES, as Windows, macOS and OpenSSL 1 write them", async () => {
    let p12 = await readFixture(kRC2AndTripleDESFixture);
    expect(p12.certificates.length).toBe(1);
    expectKeyOfCertificate(p12);
  });

  test("Triple DES, including the CA certificate", async () => {
    let p12 = await readFixture(kTripleDESChainFixture);
    // The certificate of the key, and the CA that signed it
    expect(p12.certificates.length).toBe(2);
    expectKeyOfCertificate(p12);
  });

  test("2-key Triple DES and 128 bit RC2", async () => {
    let p12 = await readFixture(kRC2128Fixture);
    expectKeyOfCertificate(p12);
  });

  test("RC4", async () => {
    let p12 = await readFixture(kRC4Fixture);
    expectKeyOfCertificate(p12);
  });

  test("Contents that are not encrypted, in a file without a MAC", async () => {
    let p12 = await readFixture(kPlainFixture);
    expectKeyOfCertificate(p12);
  });

  test("Passphrase with non-ASCII characters", async () => {
    let p12 = await readFixture(kNonASCIIFixture, "Bärchen€");
    expectKeyOfCertificate(p12);
  });

  test("An empty passphrase, which .p12 files may have", async () => {
    let p12 = await readFixture(kEmptyPassphraseFixture, "");
    expectKeyOfCertificate(p12);
    // We have no passphrase to protect the key that we store
    let pem = await p12.toPEM();
    expect(pem.match(/-----BEGIN [^-]+-----/g))
      .toEqual(["-----BEGIN PRIVATE KEY-----", "-----BEGIN CERTIFICATE-----"]);
    let key = await SMIMEPrivateKey.importPrivateKey(pem, "");
    expect(key.userIDs.contents).toEqual([kEmailAddress]);
  });

  test("No passphrase at all, which is a different key than an empty one", async () => {
    let p12 = await readFixture(kNoPassphraseFixture, "");
    expectKeyOfCertificate(p12);
  });

  test("A passphrase that the caller never set is a bug, not an empty one", async () => {
    expect(() => new PKCS12(undefined as any)).toThrow(/passphrase/i);
  });

  test("A wrong passphrase is rejected", async () => {
    await expect(readFixture(kAESFixture, "wrong")).rejects.toThrow(/passphrase/i);
    await expect(readFixture(kRC2AndTripleDESFixture, "wrong")).rejects.toThrow(/passphrase/i);
  });

  test("The key and certificates end up in an S/MIME key", async () => {
    let p12 = await readFixture(kTripleDESChainFixture);
    let key = await SMIMEPrivateKey.importPrivateKey(await p12.toPEM(), kPassphrase);
    expect(key.userIDs.contents).toEqual([kEmailAddress]);
    expect(key.keyLengthInBits).toBe(1024);
    // The CA certificate, for the chain
    expect(key.chain.length).toBe(1);
    // The key must still work after we encrypted it with the passphrase again
    let rawKey = await key.decryptKey();
    expect(rawKey.n).toBe(RSAPrivateKey.decode(PrivateKeyInfo.decode(p12.keys[0]).privateKey).n);
  });

  test("The file that the user picked is read as .p12 or as PEM", async () => {
    let bytes = base64ToBytes(kRC2AndTripleDESFixture.replace(/\s/g, ""));
    let pem = await readPrivateKeyFile(new File([bytes], "mykey.p12"), kPassphrase);
    expect(pem.match(/-----BEGIN [^-]+-----/g))
      .toEqual(["-----BEGIN ENCRYPTED PRIVATE KEY-----", "-----BEGIN CERTIFICATE-----"]);
    // Key files that are already PEM are passed through
    expect(await readPrivateKeyFile(new File([pem], "mykey.pem"), kPassphrase)).toBe(pem);
  });
});

/** PBES2 with AES-256-CBC and PBKDF2, MAC with SHA-256 */
const kAESFixture = `
  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
  ZwICCAA=
`;

/** PBES2 with DES-EDE3-CBC and PBKDF2 */
const kPBES2TripleDESFixture = `
  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
`;

/** pbeWithSHAAnd40BitRC2CBC for the certificate,
 * pbeWithSHAAnd3KeyTripleDESCBC for the key, MAC with SHA-1 */
const kRC2AndTripleDESFixture = `
  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
`;

/** pbeWithSHAAnd3KeyTripleDESCBC throughout, with 2 certificates */
const kTripleDESChainFixture = `
  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
`;

/** pbeWithSHAAnd128BitRC2CBC for the certificate,
 * pbeWithSHAAnd2KeyTripleDESCBC for the key */
const kRC2128Fixture = `
  MIIGKQIBAzCCBe8GCSqGSIb3DQEHAaCCBeAEggXcMIIF2DCCAtcGCSqGSIb3DQEHBqCCAsgwggLE
  AgEAMIICvQYJKoZIhvcNAQcBMBwGCiqGSIb3DQEMAQUwDgQI2CPRvvDfztwCAggAgIICkFqP202w
  v79CI6OKzG7JcVkjMtc4zweBnEjtmRB/Dt4eqemztrCMtymLKzlInVj7EaElTeYrLxyK3BSuO9eu
  jBvH4pk22le/9bao56sd46H5vmLb3i14xdi257TARejxR0QkRN2bpWhoY42TFW6KolwZTWGco5k/
  Zn0CPuKSUyNtZrvmypdNVSHZ5CdvUqjy+VTrMRNZil7wKRfCf51yWuPRh0GRlvH5r5Gim6gLzOmj
  1UkL/mfJEFYCLPU+a2DAN/ZwG7+rccylaAgnFQXNQMyNqJVfdwNhx0h4EOUc9ypCvfcKBnH2+AgX
  EWawlM8a8ZdzMG4UAHEDa8DrpC1NuhWRvgEaiXTsI1mi02g495fVMga7SSGpo5MJSlMT2WKdxc7M
  mEUX1892acCfTLXctpZTYREr5oSvPULth0WEjLYsx8prpsx/FQElGdmsVd7olYybv0RjWl3Vyidr
  onZHywI5teAvgVMFMS5H//TC/oJ9S0IwdB4Od84+zVHNuT3ftx3gC3i6erR38IMOokia4hVOZWR3
  Y2E2u8vZv+89X2wE2oAToLFkGO3Xqegpv4qT9ocC3d0XQ3MhwjmyZmeikxcu5Oek5zjvPfBdplFk
  vJ5xnOEAGZGeM9n1CcPhtNkd/8MP2aa6DpK+uD/7RFRmrKqalXEnDF/o6I67QXsFD2fvEUgHniVt
  HCv058HyfnSGoKITOS1y9A6IaNryfDFsoEtOFp7xC6a5PjwTZA42YcM0jlCtl9gLdJjycmYGpaE4
  RbCDMST9QE9hEM1/CC+jB79Na/gkz6/rnlkCSeTKs1dG/l8nv7CjkyTrdtCegZz5jZOqdALhFiiU
  RC+FLcaWHLnMq8unjM299MkhWHvbekqtMIIC+QYJKoZIhvcNAQcBoIIC6gSCAuYwggLiMIIC3gYL
  KoZIhvcNAQwKAQKgggKmMIICojAcBgoqhkiG9w0BDAEEMA4ECL7EpmSwzW94AgIIAASCAoDb0oA+
  BVufrQEP6fX7SbhcJkSq9b4DysUsvMczOcQ3vqw1jCMJg25nucys8ALHT0j8u4My802ciybYbCEG
  DDQP+0MqEToVXr7qmS98JocviPJfKRnW6SO41tQV3ltzRpGtYBjW6UUohDiAoIW7K8NlWGvp7Htx
  X1tMAy1ZpZfCgxiQcOlaC7kZjpOOZcJmR/KBX7vmolrlTHbYC61nlf+p4S2S7ibH0bndkpaw12D2
  dWZ4ybaTVqWt3tqqE83s2+zpao+tXi8zOvKjqknghhdAg/+6jJoZkeJ8q8u3rL5/ZqGtL+0rWwrj
  Jk9KWPY5BI5zhSkfRrVjBtjBUi0UAQMc0+rwu18RRAE2bKcxhcXmTha52lRkkb8pwfxY/qD8sise
  XqTbdgtsb0ror7yfhsY+V5XW+f8kbjq4jxaATKBRj9QGISDtoktM0+dErI/f04JJM4qeRhZU23iH
  YfPBsTRFJAoQ1fj0nW+yyo6CcujecTmfsFttX5c1XDc38XBO+iWjaiFkjCZ1bgb+eqwaXEh5JDu+
  XuCLacncj6d6+Sgt+coGUF2G4a6Cf0j5lb46762dHyQjnqDJaW9b6LumcH6i04rNgoA7PPti6v9i
  rtJ8fFGmKJ4teASCt1S2W+hqxv721Nr16BSE5n/izQZVnxOBuT5NcevUNZaCbq/wz7YsWIx9YVye
  OLfn4vljPenPNm+8baX5N5HZSL+zdH0Jkjg3RcZ2R0DUwegi/p1xxDm3noD4i8WZkynt2VTnXF7y
  ycP5Z/U4CzqknwvTVjBsTXN8/C8Ph8EwBk3qlpDGVhYFU9N0SzN9hS0LKrpVpRmwxlzSIN6l12dL
  w60WEvjGYryaMSUwIwYJKoZIhvcNAQkVMRYEFCmoVK/lWjcKRXi7P9LTe2SzjdPpMDEwITAJBgUr
  DgMCGgUABBQkFO3YRbewM6t7X7EcIt7lkXX4TAQIj+EHz12u2a0CAggA
`;

/** pbeWithSHAAnd40BitRC4 for the certificate,
 * pbeWithSHAAnd128BitRC4 for the key */
const kRC4Fixture = `
  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
`;

/** A keyBag and a certBag, both in the clear, and no macData */
const kPlainFixture = `
  MIIFkgIBAzCCBYsGCSqGSIb3DQEHAaCCBXwEggV4MIIFdDCCAp4GCSqGSIb3DQEHAaCCAo8EggKL
  MIIChzCCAoMGCyqGSIb3DQEMCgEDoIICSzCCAkcGCiqGSIb3DQEJFgGgggI3BIICMzCCAi8wggGY
  oAMCAQICFCsdOT1Tsn7gQIjwjK3twBLxKoczMA0GCSqGSIb3DQEBCwUAMBIxEDAOBgNVBAMMB1Rl
  c3QgQ0EwHhcNMjYwODE4MTkxMDA3WhcNMzYwODE1MTkxMDA3WjA1MRIwEAYDVQQDDAlUZXN0IFVz
  ZXIxHzAdBgkqhkiG9w0BCQEWEHRlc3RAZXhhbXBsZS5jb20wgZ8wDQYJKoZIhvcNAQEBBQADgY0A
  MIGJAoGBAMMpdIJgx5Eh6fPdy3ltmVVsTo6CT01qdfOl3jCHLi3OVyhQQ4PPRhwClwX2DhS58Bgx
  FOSbHm4P1xzM+fIWmreJF70cdehNLEtYIaxRhesJlSYpeNIQ54LVNort2Ucb6SQgEHVC0FUGZ3TW
  yH2t4QcWDs1hOGLWYBnQGDJV2sMfAgMBAAGjXzBdMBsGA1UdEQQUMBKBEHRlc3RAZXhhbXBsZS5j
  b20wHQYDVR0OBBYEFG9pz0D5sX7A4qNRgVacZ+sPzJJFMB8GA1UdIwQYMBaAFOKgRTpCoxBU3xtA
  9NKPthoaAWuiMA0GCSqGSIb3DQEBCwUAA4GBAE3HcUa0OpBYanmdBesB2EzB4ShK4putValT5Ht0
  lq+k4Oq7mwZntBlkKplxcwAWEYduBLMeL35qcklGyl5bWRvlyg23LE8u7wT+kzrpSFTPfHDuM/on
  cb44i3ZOi4gwOv5OlNvF5VMsXXBMRDVyBoRIeG2erGeW4P8+Th95bT21MSUwIwYJKoZIhvcNAQkV
  MRYEFCmoVK/lWjcKRXi7P9LTe2SzjdPpMIICzgYJKoZIhvcNAQcBoIICvwSCArswggK3MIICswYL
  KoZIhvcNAQwKAQGgggJ7MIICdwIBADANBgkqhkiG9w0BAQEFAASCAmEwggJdAgEAAoGBAMMpdIJg
  x5Eh6fPdy3ltmVVsTo6CT01qdfOl3jCHLi3OVyhQQ4PPRhwClwX2DhS58BgxFOSbHm4P1xzM+fIW
  mreJF70cdehNLEtYIaxRhesJlSYpeNIQ54LVNort2Ucb6SQgEHVC0FUGZ3TWyH2t4QcWDs1hOGLW
  YBnQGDJV2sMfAgMBAAECgYEAkhkljDixDTfLMPF30kY2xFkZEdwBS94HwMcJ52A7NLVET/yOHk17
  mZpivmatsdxkHWgY0O5CwHgBPCFCd3Vuiemlo9cmoXV8GvjIgZWxRJSHIJOW2N6zG1hEOg0UI3E5
  OEo/zOgY+SeNPq14gTKpwJxDB+OggM4H9UtwGdNQTXkCQQDuzosYXC9K69BQQv3ViZUSDHm/sKjH
  kMQzqhvny+1d8f0EvjHhy8IOuuY+I6+oSHTCI8QshEWQe4V0q92vNTErAkEA0TZ91aW+j2VKiQiY
  hqWV0hH5WUpybJt90lV14OTR1mcvhVm6tbY1fVYKnnioNMhV70Z7AxlqCuZEuSbkuQtz3QJBAIhS
  2Ayb81Ntsole9NCFrdeTz5yiGHd0KMzlevCj9Wj/z1R5zrf7PVhzUSR/8rK6SgzZpg9TovKL0O99
  fRub3ekCQBsiaievm4uVo5kqWD3+c/QPCLwf/78+W49QLj3A78ZTE8LD5Id03nMnGbF8DLTr1tl1
  1raMMUjAnOE2viuR5LECQEm6qaBnzXqmy5KI+Yo3yiF9aVMHhzbJsKN/mwVGRk+2Vu+KZWqsdITY
  PdL6Hy7+vTLGnAOgeNWPdfTeR4h9+kUxJTAjBgkqhkiG9w0BCRUxFgQUKahUr+VaNwpFeLs/0tN7
  ZLON0+k=
`;

/** AES again, but the passphrase is empty, as `-passout pass:` writes it.
 * The MAC and the contents are still there, both keyed off the empty
 * passphrase, so this exercises the key derivation, not a shortcut. */
const kEmptyPassphraseFixture = `
  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
`;

/** The same file, but written without any passphrase instead of with an
 * empty one, so its MAC leaves the passphrase out of the key derivation.
 * The MAC comes from `openssl kdf PKCS12KDF` with an empty `hexpass`,
 * and `openssl pkcs12 -passin pass:` reads the file. */
const kNoPassphraseFixture = `
  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
`;

/** AES again, but the passphrase is "Bärchen€" */
const kNonASCIIFixture = `
  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
  ywICCAA=
`;
