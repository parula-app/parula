import { expect, test, describe } from "vitest";
import { PrivateKeyInfo, RSAPrivateKey, RSAPublicKey, DigestInfo, Null, OctetString, ContentInfo, SignedData, EnvelopedData, AuthEnvelopedData, GCMParameters, Certificate, Oid, UTCTime, Attributes, SMIMECapabilities } from "../../../../../logic/Mail/Encryption/SMIME/SMIMEASN1";
import { decryptAuthEnveloped } from "../../../../../logic/Mail/Encryption/SMIME/SMIMEDecrypt";
import { SMIMESend, kOurCapabilities } from "../../../../../logic/Mail/Encryption/SMIME/SMIMESend";
import { BlockType, padFF, padRandom, encrypt, decrypt, unpadPKCS } from "../../../../../logic/Mail/Encryption/SMIME/SMIMERSAES";
import { verifySignedData } from "../../../../../logic/Mail/Encryption/SMIME/SMIMEVerify";
import { SMIMEPublicKey } from "../../../../../logic/Mail/Encryption/SMIME/SMIMEPublicKey";
import { appGlobal } from "../../../../../logic/app";
import { berToDER } from "../../../../../../lib/asn1/ber";
import { base64ToBytes } from "../../../../../../lib/asn1/decoders/pem";

// `verifySignedData()` compares digests using `indexedDB.cmp()`,
// which the browser has, but Node does not.
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

// `keyStatus()` needs the CA certificates from the backend. Empty is honest:
// the test certificate is self-signed, so no CA vouches for it anyway.
appGlobal.remoteApp ??= {
  async getCACertificates(type: string): Promise<string[]> {
    return [];
  },
};

/**
 * Builds an RSA private key the same way the app does: generate it with
 * WebCrypto, export as PKCS#8, and decode it through our own ASN.1 stack.
 * Uses 2048 bits (not the app's 4096) purely so the tests run quickly.
 */
async function generateRSAKey(): Promise<RSAPrivateKey> {
  let { privateKey } = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: Uint8Array.of(1, 0, 1), hash: "SHA-256" },
    true, ["sign"]);
  let privateKeyInfo = PrivateKeyInfo.decode(new Uint8Array(await crypto.subtle.exportKey("pkcs8", privateKey)));
  return RSAPrivateKey.decode(privateKeyInfo.privateKey);
}

function digestInfoDER(): Uint8Array {
  return DigestInfo.encode({
    digestAlgorithm: { algorithm: "sha256", parameters: Null.encode() },
    digest: crypto.getRandomValues(new Uint8Array(32)),
  });
}

describe("ASN.1 DER round-trip", () => {
  test("RSA public key", async () => {
    let key = await generateRSAKey();
    let decoded = RSAPublicKey.decode(RSAPublicKey.encode({ n: key.n, e: key.e }));
    expect(decoded.n).toBe(key.n);
    expect(decoded.e).toBe(key.e);
  });

  test("DigestInfo", () => {
    let digest = crypto.getRandomValues(new Uint8Array(32));
    let decoded = DigestInfo.decode(DigestInfo.encode({
      digestAlgorithm: { algorithm: "sha256", parameters: Null.encode() },
      digest,
    }));
    expect(decoded.digestAlgorithm.algorithm).toBe("sha256");
    expect(Array.from(decoded.digest)).toEqual(Array.from(digest));
  });

  test("encodeToBase64 handles large buffers without overflowing the stack", () => {
    let big = new Uint8Array(500_000); // spreading this into fromCharCode would throw
    for (let i = 0; i < big.length; i++) {
      big[i] = i & 0xff;
    }
    // Force the manual fallback, so we exercise it even where the native
    // Uint8Array.prototype.toBase64 exists.
    let native = Uint8Array.prototype.toBase64;
    delete (Uint8Array.prototype as any).toBase64;
    try {
      let decoded = OctetString.decodeFromBase64(OctetString.encodeToBase64(big));
      expect(Array.from(decoded)).toEqual(Array.from(big));
    } finally {
      if (native) {
        Uint8Array.prototype.toBase64 = native;
      }
    }
  });
});

describe("RSA + PKCS#1 v1.5", () => {
  test("encrypt/decrypt round-trips a symmetric key (RSAES)", async () => {
    let key = await generateRSAKey();
    let symmetricKey = crypto.getRandomValues(new Uint8Array(32));
    let ciphertext = encrypt(padRandom(symmetricKey, key), key);
    let recovered = unpadPKCS(decrypt(ciphertext, key), BlockType.Encrypted);
    expect(Array.from(recovered)).toEqual(Array.from(symmetricKey));
  });

  test("sign/verify round-trips a DigestInfo (RSASSA)", async () => {
    let key = await generateRSAKey();
    let digestInfo = digestInfoDER();
    let signature = decrypt(padFF(digestInfo, key), key);
    let recovered = unpadPKCS(encrypt(signature, key), BlockType.Signed);
    expect(Array.from(recovered)).toEqual(Array.from(digestInfo));
  });

  test("unpadPKCS rejects signature padding that is not all 0xFF (BERserk hardening)", async () => {
    let key = await generateRSAKey();
    let block = padFF(digestInfoDER(), key);
    expect(() => unpadPKCS(block, BlockType.Signed)).not.toThrow();
    // Replace a padding octet with a non-0xFF, non-zero byte. The old, lenient
    // unpadding accepted this because it only required a run of non-zero bytes.
    let tampered = block.slice();
    tampered[5] = 0xab;
    expect(() => unpadPKCS(tampered, BlockType.Signed)).toThrow();
  });
});

/* Test messages, generated with:
 * openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 30 -nodes \
 *   -subj "/CN=Test Signer/emailAddress=signer@example.com"
 * printf 'Content-Type: text/plain\r\n\r\nHello, opaque world!\r\n' > content.txt
 * DER:       openssl smime -sign -in content.txt -signer cert.pem -inkey key.pem -nodetach -noindef -outform DER
 * streaming: openssl cms -sign -in content.txt -signer cert.pem -inkey key.pem -nodetach -stream -outform DER
 * no attrs:  openssl cms -sign -in content.txt -signer cert.pem -inkey key.pem -nodetach -noattr -stream -outform DER
 * encrypted: openssl cms -encrypt -in content.txt -aes256 -recip cert.pem -stream -outform DER
 * The streaming form is what Outlook and OpenSSL emit: BER with indefinite
 * lengths and chunked strings. */

const kOpaqueContent = "Content-Type: text/plain\r\n\r\nHello, opaque world!\r\n";

const kSignerCert = `
-----BEGIN CERTIFICATE-----
MIIDUzCCAjugAwIBAgIUAQW15cvskbzwNvhVJXyq52QDxaEwDQYJKoZIhvcNAQEL
BQAwOTEUMBIGA1UEAwwLVGVzdCBTaWduZXIxITAfBgkqhkiG9w0BCQEWEnNpZ25l
ckBleGFtcGxlLmNvbTAeFw0yNjA4MDYwNDM5MDhaFw0yNjA5MDUwNDM5MDhaMDkx
FDASBgNVBAMMC1Rlc3QgU2lnbmVyMSEwHwYJKoZIhvcNAQkBFhJzaWduZXJAZXhh
bXBsZS5jb20wggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQC4k0cl19gs
x4Xl1cHEKDcWQlXKxOSukx61JUWRBOO7xbSe1AtwOMiW1JqkQX3kfa0w8ZmSGVHx
kdgrFOlR338FvlFb69kXRvNzUGeItQe74VNtx0tQXnPXqY+Tagu5ADylnmigrOu2
rg5c+SBLOJQAoWtMD6mbM6KYCRR19eldVgxcCof7F4Y3G7STtG4qpGKICuVJId7z
Rnqu3yXNG3xOYxzzTS5zr6e93Hw/yDv1xzRxDI+SbIw0L4ACEBH8s8YfaNaiANdG
JJ2Xx1P+efrnkspHatB7q9A7lqciLOlDnyAZCAjjAO2p72ZnpKkFvjudEBr4rHZ/
99j9TTnt0SAdAgMBAAGjUzBRMB0GA1UdDgQWBBTujBkKZezwOop+jqJtHfK7RwFr
rzAfBgNVHSMEGDAWgBTujBkKZezwOop+jqJtHfK7RwFrrzAPBgNVHRMBAf8EBTAD
AQH/MA0GCSqGSIb3DQEBCwUAA4IBAQBoXOLO6OTXNPAQ5RqtP7mQ28dCu6bkeJSa
0a+Aov1GK88Hs0XhoC4JO6EvEAOgvjHpXfCS0UVmN+G87wcJwBUFfi8hRpukkChm
9pljV8ae7QXZda9p3BMq17F2dTnPV6UoFhhrh9sFFbqthIL9wHudNHhtmSptuDFS
sZBeHGzYLMtQyCqUaEw+29hj3xGC1oa0lpr4lGw6bT4MLo9CUw+Kgmy7+SbwkOVD
IQTe2BtjfHHDGT55E95h5IdbModq2XwqVL5Q9IE+AF+pHsaXqNgftU6a6mNHDrYW
l4zpoSh99If6kRdiy11N0gE6GKhZEXdjsLWMOugiyXKPnpI80lv9
-----END CERTIFICATE-----
`;

const kSignerKey = `
-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC4k0cl19gsx4Xl
1cHEKDcWQlXKxOSukx61JUWRBOO7xbSe1AtwOMiW1JqkQX3kfa0w8ZmSGVHxkdgr
FOlR338FvlFb69kXRvNzUGeItQe74VNtx0tQXnPXqY+Tagu5ADylnmigrOu2rg5c
+SBLOJQAoWtMD6mbM6KYCRR19eldVgxcCof7F4Y3G7STtG4qpGKICuVJId7zRnqu
3yXNG3xOYxzzTS5zr6e93Hw/yDv1xzRxDI+SbIw0L4ACEBH8s8YfaNaiANdGJJ2X
x1P+efrnkspHatB7q9A7lqciLOlDnyAZCAjjAO2p72ZnpKkFvjudEBr4rHZ/99j9
TTnt0SAdAgMBAAECggEABdT7esXg6ftM7wfrxS2rHewvJ0bE3gI+hmU81znzEygK
Trlu+hcFOYTStQ1vs6RH8GO14UClDu+3h5bzz1czPYR3sCKZ26stfo+EEfT8X1Kd
jvqs1ceCPAZ6x6LiZ3BLOkVw02DbWsyRnhzuCQpq3ME88WyORJ3jTY/94kNIoh8L
wbgBK+brL0ELH0FImV8Lpccf4HGOKQNTVmIcVFGHJ1lxKOqtOca5ZQ94jN0LTwX0
ZEVtKclN0njtvbJzAb+p/BWTcKLB4jnf3RHDQjrwRZ8IaVE42+mzm0N74ydt2NS3
7UAbu8SKH5rPSCh7oBwjCae1eoAEIvQ56SST4Sk4+QKBgQD+LHUrXZVimf8viRvc
QXKAcKj0qPE2cgV62rnoGvdhsw9x6xMoXnaYcjhUd2+mDKAzb+PJ/7xHnQ/zlK2n
mEqN40fTkfmQRHgG0HiZYVW0LVWlDlPTq1XqjzJTS4W39YgeLQ1fHf+HlAn2wRuh
jiWOkIskaX7VRD7dXWm2hwJn9QKBgQC55sv8yQOI36AS5aSsKZYkYIk0BlhUXlTE
ZnbO72KCCSBco60yAdHXWaCuH51kuto+BG1My1gzjrdtsMS0W7xsKIbQyD0dSNnr
AZT4XcI1iTbONVVlscLnEYnMcz+/cZAJf245p8u6MhdlNUKuccjPcV5ISBfyhYOH
9QHUeKDGiQKBgDY1ExQZlFeAEl1391olFx9vZ4kuUqtS6/pElat7vNC4WI3qHZ7Z
bp+alIrnIgee37e4oDMfeG8pfxJq3hJFN3lFRLdJhZkQES0a3u2PRbD0jjRydsxI
2Tz6Jzh+fdk64znUT+q+QhYPK4TVsGfnIfliuFoeqa8gK+wYFQiZiJjVAoGBAKmN
K82BlNy4gSnbEycGwu6osVqm0tcYNh3vCjtQsDrDkiWMDwIGENpl35wQL6BYn4Zi
yUF6URas+vVrfOy2opLPH666gqr77+1cQv+HnALyA+9tS1b2Gzpej5zOHH1CWUmg
VOr29GP9HcNsIUYzdyBkWMZ6IoVKap2Mw7+CybhpAoGBAPLAOWDtWjvtBTTU4Ytr
I4PIED+ioWRXG39hJGBcqGla6u6BhRKg+BiHRI/HzMdre+CzCx5Om2nV/1Wci3sY
hN9uf61G5YsdXQOE2bBdjpNkyiRkQVWme11tXj4PQuULjRZR0NQ9F3v4u5SYqEZz
IgIHjHoJbZdOg30iqw1JPbLa
-----END PRIVATE KEY-----
`;

const kOpaqueSignedDER = `
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
DSQi/snYsPzc
`;

const kOpaqueSignedStreaming = `
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
zK1AwjQqawAAAAAAAA==
`;

const kOpaqueSignedNoAttrs = `
MIAGCSqGSIb3DQEHAqCAMIACAQExDTALBglghkgBZQMEAgEwgAYJKoZIhvcNAQcBoIAkgAQyQ29udGVudC1UeXBlOiB0ZXh0L3Bs
YWluDQoNCkhlbGxvLCBvcGFxdWUgd29ybGQhDQoAAAAAAACgggNXMIIDUzCCAjugAwIBAgIUAQW15cvskbzwNvhVJXyq52QDxaEw
DQYJKoZIhvcNAQELBQAwOTEUMBIGA1UEAwwLVGVzdCBTaWduZXIxITAfBgkqhkiG9w0BCQEWEnNpZ25lckBleGFtcGxlLmNvbTAe
Fw0yNjA4MDYwNDM5MDhaFw0yNjA5MDUwNDM5MDhaMDkxFDASBgNVBAMMC1Rlc3QgU2lnbmVyMSEwHwYJKoZIhvcNAQkBFhJzaWdu
ZXJAZXhhbXBsZS5jb20wggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQC4k0cl19gsx4Xl1cHEKDcWQlXKxOSukx61JUWR
BOO7xbSe1AtwOMiW1JqkQX3kfa0w8ZmSGVHxkdgrFOlR338FvlFb69kXRvNzUGeItQe74VNtx0tQXnPXqY+Tagu5ADylnmigrOu2
rg5c+SBLOJQAoWtMD6mbM6KYCRR19eldVgxcCof7F4Y3G7STtG4qpGKICuVJId7zRnqu3yXNG3xOYxzzTS5zr6e93Hw/yDv1xzRx
DI+SbIw0L4ACEBH8s8YfaNaiANdGJJ2Xx1P+efrnkspHatB7q9A7lqciLOlDnyAZCAjjAO2p72ZnpKkFvjudEBr4rHZ/99j9TTnt
0SAdAgMBAAGjUzBRMB0GA1UdDgQWBBTujBkKZezwOop+jqJtHfK7RwFrrzAfBgNVHSMEGDAWgBTujBkKZezwOop+jqJtHfK7RwFr
rzAPBgNVHRMBAf8EBTADAQH/MA0GCSqGSIb3DQEBCwUAA4IBAQBoXOLO6OTXNPAQ5RqtP7mQ28dCu6bkeJSa0a+Aov1GK88Hs0Xh
oC4JO6EvEAOgvjHpXfCS0UVmN+G87wcJwBUFfi8hRpukkChm9pljV8ae7QXZda9p3BMq17F2dTnPV6UoFhhrh9sFFbqthIL9wHud
NHhtmSptuDFSsZBeHGzYLMtQyCqUaEw+29hj3xGC1oa0lpr4lGw6bT4MLo9CUw+Kgmy7+SbwkOVDIQTe2BtjfHHDGT55E95h5Idb
Modq2XwqVL5Q9IE+AF+pHsaXqNgftU6a6mNHDrYWl4zpoSh99If6kRdiy11N0gE6GKhZEXdjsLWMOugiyXKPnpI80lv9MYIBejCC
AXYCAQEwUTA5MRQwEgYDVQQDDAtUZXN0IFNpZ25lcjEhMB8GCSqGSIb3DQEJARYSc2lnbmVyQGV4YW1wbGUuY29tAhQBBbXly+yR
vPA2+FUlfKrnZAPFoTALBglghkgBZQMEAgEwDQYJKoZIhvcNAQEBBQAEggEALiFSRBsW8KXN6qHYlFdFXwJ1oFPTw3pNPAJkScr6
YgU+7oFykMM9/GmVaqnUi6WqSC7Sgd0RCvVRg7FpA9xDQwqpgfgyvegDlyAdyBZJrZTqxla5fnHBeUIC1nuMGG8PwvvxMGJblbjj
jbA6pxpXrHzX8fBUl2SBHKq+MtSjWHzJnoIYIdbpA8ZP4QCXgpW3AjljNjt+SeDLm7hiKQCGRmDvmPPSZNN0GPCULto9gSBmpvvD
MaMpNAk3mYDT5RVd90eldfOyZIx/D9w+ooTgVzFCFKtT3Vhp4ynbJ54OhAjj1fihju+NCIHlixVtKE4wuc3CZbW9iy9cm9sIz+st
DgAAAAAAAA==
`;

const kEncryptedStreaming = `
MIAGCSqGSIb3DQEHA6CAMIACAQAxggFtMIIBaQIBADBRMDkxFDASBgNVBAMMC1Rlc3QgU2lnbmVyMSEwHwYJKoZIhvcNAQkBFhJz
aWduZXJAZXhhbXBsZS5jb20CFAEFteXL7JG88Db4VSV8qudkA8WhMA0GCSqGSIb3DQEBAQUABIIBAAbm5jNVXNtlztkWVJ2o4ztS
u1w8NiLoSfxwpjdrFxVFt7ax/3CTNjJCbufBUKWvYRDOw7nh2UhYlcGtTrVRAITrzkqh8ZNNPm5mfOGs75FjnXyUZwoOwu4r3VmG
B6dwh/ANC3KBf+KWVvVoLVCHtSlOXSWOD210BCsoO6wcuDTkq6sS7BBuQkQ0ucpg8gEp0ZveC9aiRfDU3g0Zr8Ey0V95ar4vClcq
Bgyn7mcXfax+L+KS4W4XvwGicg8k0YUx3wD0tuqxkISvUB3nZDACbCVDkxN/NWl/0Um45aGFX89IRvBLVDkgZ/8A1vyuiWwF/141
GGrhS6I+ZUWqF7an89UwgAYJKoZIhvcNAQcBMB0GCWCGSAFlAwQBKgQQFIytNgoOVedP2oS9oMTwVKCABDBZT88jLwIjyPRC1MnF
A3wcgtodjMMasKVm9sOX9Ja48mkCD8sA5L1PfFLbWa2x1VUEEGgMGxrugKYvwiROWMyLUkcAAAAAAAAAAAAA
`;

describe("Opaque-signed and streaming BER messages (Outlook style)", () => {
  async function signerKeyID(): Promise<string> {
    return (await SMIMEPublicKey.importPublicKey(kSignerCert)).id;
  }

  async function readOpaque(base64: string): Promise<{ content: Uint8Array, signer: SMIMEPublicKey | null }> {
    let signedData = SignedData.decodeFromBase64(base64, { berToDER: true });
    expect(signedData.content.contentInfo.contentType).toBe("data");
    let content = OctetString.decode(signedData.content.contentInfo.content);
    let signer = await verifySignedData(signedData, content);
    return { content, signer };
  }

  test("berToDER leaves DER unchanged", () => {
    let blob = base64ToBytes(kOpaqueSignedDER);
    expect(berToDER(blob)).toBe(blob); // the same object, no copy
  });

  test("berToDER throws on truncated input", () => {
    let blob = base64ToBytes(kOpaqueSignedStreaming);
    for (let length of [0, 1, 2, 5, 20, 100, blob.length - 1]) {
      expect(() => berToDER(blob.subarray(0, length))).toThrow();
    }
  });

  test("ContentInfo identifies the kind of CMS blob", () => {
    expect(ContentInfo.decodeFromBase64(kOpaqueSignedDER, { berToDER: true }).contentType).toBe("signedData");
    expect(ContentInfo.decodeFromBase64(kEncryptedStreaming, { berToDER: true }).contentType).toBe("envelopedData");
  });

  test("reads and verifies an opaque-signed message (DER)", async () => {
    let { content, signer } = await readOpaque(kOpaqueSignedDER);
    expect(new TextDecoder().decode(content)).toBe(kOpaqueContent);
    expect(signer?.id).toBe(await signerKeyID());
  });

  test("reads and verifies an opaque-signed message (streaming BER)", async () => {
    let { content, signer } = await readOpaque(kOpaqueSignedStreaming);
    expect(new TextDecoder().decode(content)).toBe(kOpaqueContent);
    expect(signer?.id).toBe(await signerKeyID());
  });

  test("verifies a signature without signed attributes", async () => {
    let { signer } = await readOpaque(kOpaqueSignedNoAttrs);
    expect(signer?.id).toBe(await signerKeyID());
  });

  test("rejects a signature over other content", async () => {
    let signedData = SignedData.decodeFromBase64(kOpaqueSignedStreaming, { berToDER: true });
    let tampered = new TextEncoder().encode(kOpaqueContent.replace("Hello", "Evil!"));
    expect(await verifySignedData(signedData, tampered)).toBeNull();
  });

  test("decrypts a streaming BER encrypted message (chunked encryptedContent)", async () => {
    let envelopedData = EnvelopedData.decodeFromBase64(kEncryptedStreaming, { berToDER: true });
    let info = envelopedData.content.encryptedContentInfo;
    expect(info.contentEncryptionAlgorithm.algorithm).toBe("aes256cbc");
    let recipientInfo = envelopedData.content.recipientInfos[0];
    expect(recipientInfo.type).toBe("ktri");
    let privateKeyInfo = PrivateKeyInfo.decodePEM(kSignerKey, { label: "PRIVATE KEY" });
    let privateKey = RSAPrivateKey.decode(privateKeyInfo.privateKey);
    let symmetricKey = unpadPKCS(decrypt(recipientInfo.value.encryptedKey, privateKey), BlockType.Encrypted);
    let key = await crypto.subtle.importKey("raw", symmetricKey, "AES-CBC", false, ["decrypt"]);
    let vector = OctetString.decode(info.contentEncryptionAlgorithm.parameters);
    let decrypted = await crypto.subtle.decrypt({ name: "AES-CBC", iv: vector }, key, info.encryptedContent);
    expect(new TextDecoder().decode(decrypted)).toBe(kOpaqueContent);
  });
});

describe("Signed attributes", () => {
  /** The attributes that `SMIMESend` signs, with values of realistic size */
  function signedAttributes(): any[] {
    return [{
      attrType: "contentType",
      attrValue: [Oid.encode("data")],
    }, {
      attrType: "signingTime",
      attrValue: [UTCTime.encode(Date.parse("2026-08-18T15:00:00Z"))],
    }, {
      attrType: "messageDigest",
      attrValue: [OctetString.encode(new Uint8Array(32))],
    }, {
      attrType: "smimeCapabilities",
      attrValue: [SMIMECapabilities.encode(kOurCapabilities)],
    }];
  }

  test("We announce the ciphers that we can actually decrypt", () => {
    let capabilities = SMIMECapabilities.decode(SMIMECapabilities.encode(kOurCapabilities));
    // Best first within each category, so that the correspondent picks the
    // strongest that we both have. The ciphers first, because that is the
    // decision that we most need to steer, and the authenticating ones before
    // the rest. No SHA-1, and no `parameters` on any of them.
    expect(capabilities.map(capability => capability.capabilityID)).toEqual([
      "aes256gcm", "aes192gcm", "aes128gcm",
      "aes256cbc", "aes192cbc", "aes128cbc",
      "sha512WithRSAEncryption", "sha384WithRSAEncryption", "sha256WithRSAEncryption",
      "sha512", "sha384", "sha256",
      "rsaEncryption",
    ]);
    expect(capabilities.every(capability => capability.parameters === undefined)).toBe(true);
  });

  test("The signed attributes are in canonical DER SET OF order", () => {
    // X.690 section 11.6: the elements of a SET OF must be sorted by their
    // encoding. `SMIMESend` relies on listing them in that order itself,
    // because our encoder does not sort them.
    let elements = splitSetOf(Attributes.encode(signedAttributes()));
    expect(elements.length).toBe(4);
    for (let i = 1; i < elements.length; i++) {
      expect(indexedDB.cmp(elements[i - 1], elements[i])).toBe(-1);
    }
  });

  test("The attributes survive the round trip", () => {
    let decoded = Attributes.decode(Attributes.encode(signedAttributes()));
    expect(decoded.map(attribute => attribute.attrType))
      .toEqual(["contentType", "signingTime", "messageDigest", "smimeCapabilities"]);
  });
});

/** Splits a DER SET OF into the encodings of its elements */
function splitSetOf(encoded: Uint8Array): Uint8Array[] {
  let elements: Uint8Array[] = [];
  let pos = 1 + derLength(encoded, 1).size;
  while (pos < encoded.length) {
    let { size, length } = derLength(encoded, pos + 1);
    elements.push(encoded.subarray(pos, pos + 1 + size + length));
    pos += 1 + size + length;
  }
  return elements;
}

/** Reads the DER length field at `pos`.
 * @returns `size`: how many bytes the length field itself takes,
 *   `length`: the length of the content that follows it */
function derLength(encoded: Uint8Array, pos: number): { size: number, length: number } {
  if (!(encoded[pos] & 0x80)) {
    return { size: 1, length: encoded[pos] };
  }
  let size = encoded[pos] & 0x7F;
  let length = 0;
  for (let i = 1; i <= size; i++) {
    length = length << 8 | encoded[pos + i];
  }
  return { size: size + 1, length };
}

/* Encrypted with AES-GCM, which CMS wraps in authenticated-enveloped-data
 * (RFC 5083) instead of enveloped-data, generated with:
 * openssl cms -encrypt -in content.txt -aes-256-gcm -recip cert.pem -outform DER
 */
const kEncryptedGCM = `
  MIIB/AYLKoZIhvcNAQkQARegggHrMIIB5wIBADGCAW0wggFpAgEAMFEwOTEUMBIGA1UE
  AwwLVGVzdCBTaWduZXIxITAfBgkqhkiG9w0BCQEWEnNpZ25lckBleGFtcGxlLmNvbQIU
  AQW15cvskbzwNvhVJXyq52QDxaEwDQYJKoZIhvcNAQEBBQAEggEAD2lp/aQhP5c99Xvk
  Tb+54Dvn2/QwveznzLJqX5XmT5jPibZy8jAnHslh/2POfpvWoDwjIE0uUZzPz4nDYHvq
  Mw5bC7J6PZw8EQzlNtZpXu23cM4Gv60wPPr9HMVn5xJF62SmihCPTCxJYWRLAp6hGBPJ
  aj7LGAyRpXsGZDj4mcSVu5oLXVz3JTBkAQHIRlPND0kWjc/EgS2HkqiBAbIQik5zQA86
  P+vxvh1f6yhJ6tGGk70tJt33YM2rdNc3BYcsRSuma5f40HbqbQYvwRPe+FMqal88clkX
  htj0u+aKn5RgNdwT5yEM677aOR+AgdxSAWSS7KMuPRZVT+JhaWRgUDBfBgkqhkiG9w0B
  BwEwHgYJYIZIAWUDBAEuMBEEDAfDsHhS8yvWH9bOVwIBEIAyb58DT/Mlayhva4vEVR+M
  Q8XmWXY3k4zj3nQ7lxuoH3Zu/iKxnZpEEle3NAxPVhdZvm0EEIGSe7Th4kzHYD4dT7m+
  KfY=
`;

describe("AES-GCM (authenticated-enveloped-data)", () => {
  /** Unwraps the content encryption key the same way `SMIMEReadProcessor` does */
  function symmetricKey(authEnvelopedData: any): Uint8Array {
    let privateKeyInfo = PrivateKeyInfo.decodePEM(kSignerKey, { label: "PRIVATE KEY" });
    let privateKey = RSAPrivateKey.decode(privateKeyInfo.privateKey);
    let recipientInfo = authEnvelopedData.recipientInfos[0];
    expect(recipientInfo.type).toBe("ktri");
    return unpadPKCS(decrypt(recipientInfo.value.encryptedKey, privateKey), BlockType.Encrypted);
  }

  test("recognises the content type", () => {
    expect(ContentInfo.decodeFromBase64(kEncryptedGCM).contentType).toBe("authEnvelopedData");
  });

  test("reads the cipher and its parameters", () => {
    let content = AuthEnvelopedData.decodeFromBase64(kEncryptedGCM).content;
    let algorithm = content.authEncryptedContentInfo.contentEncryptionAlgorithm;
    expect(algorithm.algorithm).toBe("aes256gcm");
    let { nonce, icvLen } = GCMParameters.decode(algorithm.parameters);
    expect(nonce.length).toBe(12);
    // OpenSSL sends the full 16 bytes, rather than relying on the default of 12
    expect(Number(icvLen)).toBe(16);
    expect(content.mac.length).toBe(16);
  });

  test("decrypts the message", async () => {
    let content = AuthEnvelopedData.decodeFromBase64(kEncryptedGCM).content;
    let decrypted = await decryptAuthEnveloped(content, symmetricKey(content));
    expect(new TextDecoder().decode(decrypted)).toBe(kOpaqueContent);
  });

  test("rejects a tampered message", async () => {
    let content = AuthEnvelopedData.decodeFromBase64(kEncryptedGCM).content;
    let key = symmetricKey(content);
    content.authEncryptedContentInfo.encryptedContent[0] ^= 0xFF;
    await expect(decryptAuthEnveloped(content, key)).rejects.toThrow();
  });
});

describe("Content to sign or encrypt", () => {
  // A text-only mail, as nodemailer creates it
  const mime = [
    `From: a@example.com`,
    `Subject: =?UTF-8?Q?Gr=C3=BC=C3=9Fe?=`,
    `Content-Transfer-Encoding: quoted-printable`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain;`,
    ` charset=utf-8`,
    ``,
    `Gr=C3=BC=C3=9Fe`,
    ``,
  ].join("\r\n");

  test("keeps all Content-* headers with the body, e.g. the transfer encoding", async () => {
    let { content } = await SMIMESend.splitOffContent(mime);
    expect(content).toBe([
      `Content-Transfer-Encoding: quoted-printable`,
      `Content-Type: text/plain;`,
      ` charset=utf-8`,
      ``,
      `Gr=C3=BC=C3=9Fe`,
      ``,
    ].join("\r\n"));
  });

  test("leaves the other headers for the outer message", async () => {
    let { otherHeaders } = await SMIMESend.splitOffContent(mime);
    expect(otherHeaders).toEqual([
      `From: a@example.com`,
      `Subject: =?UTF-8?Q?Gr=C3=BC=C3=9Fe?=`,
      `MIME-Version: 1.0`,
    ]);
  });

  test("adds a Content-Type, if the message has none", async () => {
    let { content } = await SMIMESend.splitOffContent("Subject: Hi\r\nContent-Transfer-Encoding: 7bit\r\n\r\nHello\r\n");
    expect(content).toBe("Content-Type: text/plain\r\nContent-Transfer-Encoding: 7bit\r\n\r\nHello\r\n");
  });
});
