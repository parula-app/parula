/** Sealed Sender (v1 + v2) — clean-room port of libsignal `sealed_sender.rs`.
 *
 * Known-answer tests use the certificate fixtures committed in libsignal's
 * `sealed_sender.rs` (`test_lossless_round_trip`, `test_uuid_bytes_representation`),
 * which are signed by the trust root whose private key is all-zero. The rest are
 * our-encrypt → our-decrypt round-trips for v1 and v2, plus chain-verify and
 * tamper-rejection. */
import {
  CiphertextType, ContentHint,
  deriveUnidentifiedAccessKey,
  deserializeSenderCertificate, validateSenderCertificate, validateServerCertificate,
  newServerCertificate, newSenderCertificate,
  serializeUSMC, deserializeUSMC,
  sealedSenderEncryptV1, sealedSenderEncryptV2, sealedSenderEncryptV2Single,
  v2ReceivedMessageForRecipient,
  sealedSenderDecrypt, sealedSenderDecryptToUSMC,
  type SenderCertificate, type V2Recipient,
} from "../../../../logic/Chat/Signal/Encryption/SealedSender";
import { kSignalTrustRoots } from "../../../../logic/Chat/Signal/Encryption/trustRoot";
import { KeyPair } from "../../../../logic/Chat/Signal/Crypto/KeyPair";
import { djbEncode } from "../../../../logic/Chat/Signal/Crypto/curve";
import { encode } from "../../../../logic/Chat/Signal/Proto/codec";
import * as proto from "../../../../logic/Chat/Signal/Proto/sealedSender";
import { x25519 } from "@noble/curves/ed25519.js";
import { hexToBytes, bytesToHex } from "@noble/curves/utils.js";
import { expect, test } from "vitest";

// The trust root: the X25519 public key of an all-zero private key.
const trustRootPriv = new Uint8Array(32);
const trustRootPub = x25519.getPublicKey(trustRootPriv);

/** Wrap a serialized inner Certificate + signature into a SenderCertificate blob. */
function wrapSenderCert(certificateHex: string, signatureHex: string): Uint8Array {
  return encode(proto.SenderCertificate, {
    certificate: hexToBytes(certificateHex),
    signature: hexToBytes(signatureHex),
  });
}

// --- KAT: committed SenderCertificate fixtures (uuidString form) ---

test("KAT: parses + validates libsignal's committed SenderCertificate (uuidString)", () => {
  let blob = wrapSenderCert(
    "100119697a0000000000002221056c9d1f8deb82b9a898f9c277a1b74989ec009afb5c0acb5e8e69e3d5ca29d6322a690a2508011221053b03ca070e6f6b2f271d32f27321689cdf4e59b106c10b58fbe15063ed868a5a124024bc92954e52ad1a105b5bda85c9db410dcfeb42a671b45a523b3a46e9594a8bde0efc671d8e8e046b32c67f59b80a46ffdf24071850779bc21325107902af89322461616161616161612d373030302d313165622d623332612d333362386138613438376136ba3e136372617368696e6720726967687420646f776e",
    "a22d8f86f5d00794f319add821e342c6ffffb6b34f741e569f8b321ab0255f2d1757ecf648e53a3602cae8f09b3fc80dcf27534d67efd272b6739afc31f75c8c",
  );
  let cert = deserializeSenderCertificate(blob);
  expect(cert.senderUuid).toBe("aaaaaaaa-7000-11eb-b32a-33b8a8a487a6");
  expect(cert.senderE164).toBeUndefined();
  expect(cert.senderDeviceId).toBe(1);
  expect(cert.expiration).toBe(31337n);
  // Chain validates at t < expires, fails at t > expires.
  expect(validateSenderCertificate(cert, [trustRootPub], 31336n)).toBe(true);
  expect(validateSenderCertificate(cert, [trustRootPub], 31338n)).toBe(false);
});

test("KAT: parses + validates committed SenderCertificate (uuidBytes form)", () => {
  let blob = wrapSenderCert(
    "100119697a000000000000222105e083a8ce423d1c1955174107a85a6a7f3bcbf566723624077f75eafe8e0a07752a690a25080112210507a24397ae27d06fa76d2f02cfb5546e0b23a7e0c3670c1eb1e73b135a8e1e4d12407d127509ae1f5e9dcaa511793d3e94350dcb269e4ca54500da6e1f4dc13d95940c15badef019edfe8666315500c54e4489d4b83f6ce79c7f65c9772a1a83d88c3a10aaaaaaaa700011ebb32a33b8a8a487a6",
    "755c428e9bf6ba367152f1e545834649b4e8f70df8383a352a953fdb774862af5d42fab573fc52b90ad47c331c36f93b1a4fa7a2504917d895452ffe7f44bd0e",
  );
  let cert = deserializeSenderCertificate(blob);
  expect(cert.senderUuid).toBe("aaaaaaaa-7000-11eb-b32a-33b8a8a487a6");
  expect(cert.senderDeviceId).toBe(1);
  expect(cert.expiration).toBe(31337n);
  expect(validateSenderCertificate(cert, [trustRootPub], 31336n)).toBe(true);
});

test("KAT: parses + validates a by-id SenderCertificate (signer referenced by id, not embedded)", () => {
  // libsignal sealed_sender.rs test_known_server_cert: the signer is field 8 = the
  // 0x7357C357 KNOWN_SERVER_CERTIFICATES id (not an embedded ServerCertificate). That
  // cert is signed by the all-zero private key's public key (= trustRootPub).
  let blob = wrapSenderCert(
    "100119697a000000000000222105d75b13e15c7700079dd226f51e5a790ba395e819e88a74d0cf5cedfad8b4334840d786df9a07322461616161616161612d373030302d313165622d623332612d333362386138613438376136",
    "e62667bce627caed56ca2ab309b6ae7bc890a30a7482c0e1fd77ec9c3b7528abfd45c8c42b240509a71d973ef5e0f1dbd2685fe01410f0fdbaa8fb247a67e08f",
  );
  let cert = deserializeSenderCertificate(blob);
  expect(cert.senderUuid).toBe("aaaaaaaa-7000-11eb-b32a-33b8a8a487a6");
  expect(cert.senderDeviceId).toBe(1);
  expect(cert.signer.keyId).toBe(0x7357C357); // resolved from the known-cert table
  expect(validateSenderCertificate(cert, [trustRootPub], 31336n)).toBe(true);
});

test("a by-id SenderCertificate signed with libsignal's test server certificate fails against Signal's trust roots", () => {
  // The keys of the test certificate are public, so anybody could sign such a certificate for any sender.
  let blob = wrapSenderCert(
    "100119697a000000000000222105d75b13e15c7700079dd226f51e5a790ba395e819e88a74d0cf5cedfad8b4334840d786df9a07322461616161616161612d373030302d313165622d623332612d333362386138613438376136",
    "e62667bce627caed56ca2ab309b6ae7bc890a30a7482c0e1fd77ec9c3b7528abfd45c8c42b240509a71d973ef5e0f1dbd2685fe01410f0fdbaa8fb247a67e08f",
  );
  let cert = deserializeSenderCertificate(blob);
  expect(validateSenderCertificate(cert, kSignalTrustRoots, 31336n)).toBe(false);
});

test("Signal's production server certificate id 3 is signed by one of Signal's trust roots", () => {
  let certificate = encode(proto.SenderCertificateInner, {
    senderDevice: 1,
    expires: 31337n,
    identityKey: djbEncode(KeyPair.generate().publicKey),
    uuidString: "aaaaaaaa-7000-11eb-b32a-33b8a8a487a6",
    signerId: 3,
  });
  let cert = deserializeSenderCertificate(encode(proto.SenderCertificate, { certificate, signature: new Uint8Array(64) }));
  expect(kSignalTrustRoots.some(trustRoot => validateServerCertificate(cert.signer, trustRoot))).toBe(true);
});

test("KAT: a SenderCertificate signed by the wrong trust root fails validation", () => {
  let blob = wrapSenderCert(
    "100119697a0000000000002221056c9d1f8deb82b9a898f9c277a1b74989ec009afb5c0acb5e8e69e3d5ca29d6322a690a2508011221053b03ca070e6f6b2f271d32f27321689cdf4e59b106c10b58fbe15063ed868a5a124024bc92954e52ad1a105b5bda85c9db410dcfeb42a671b45a523b3a46e9594a8bde0efc671d8e8e046b32c67f59b80a46ffdf24071850779bc21325107902af89322461616161616161612d373030302d313165622d623332612d333362386138613438376136ba3e136372617368696e6720726967687420646f776e",
    "a22d8f86f5d00794f319add821e342c6ffffb6b34f741e569f8b321ab0255f2d1757ecf648e53a3602cae8f09b3fc80dcf27534d67efd272b6739afc31f75c8c",
  );
  let cert = deserializeSenderCertificate(blob);
  let wrongRoot = x25519.getPublicKey(new Uint8Array(32).fill(7));
  expect(validateSenderCertificate(cert, [wrongRoot], 31336n)).toBe(false);
});

// --- a freshly-built cert chain ---

/** Build a fresh server + sender certificate chain for round-trip tests. */
function makeCertChain(senderIdentity: KeyPair, senderUuid = "11111111-2222-3333-4444-555555555555") {
  let serverKey = KeyPair.generate();
  let serverCert = newServerCertificate(99, serverKey.publicKey, trustRootPriv);
  let senderCert = newSenderCertificate({
    senderUuid,
    senderIdentityKey: senderIdentity.publicKey,
    senderDeviceId: 3,
    expiration: 1_700_000_000_000n,
    signer: serverCert,
    signerPriv: serverKey.privateKey,
  });
  return { serverKey, serverCert, senderCert };
}

test("a freshly-built cert chain verifies, and the inner ServerCertificate verifies against the trust root", () => {
  let sender = KeyPair.generate();
  let { serverCert, senderCert } = makeCertChain(sender);
  expect(validateServerCertificate(serverCert, trustRootPub)).toBe(true);
  expect(validateSenderCertificate(senderCert, [trustRootPub], 1_699_999_999_000n)).toBe(true);
  // Expired
  expect(validateSenderCertificate(senderCert, [trustRootPub], 1_700_000_000_001n)).toBe(false);
});

test("a revoked server certificate id is rejected", () => {
  let serverKey = KeyPair.generate();
  let revoked = newServerCertificate(0xDEADC357, serverKey.publicKey, trustRootPriv);
  expect(validateServerCertificate(revoked, trustRootPub)).toBe(false);
});

// --- USMC round-trip ---

test("USMC serializes + deserializes, with Default contentHint encoded as absent", () => {
  let sender = KeyPair.generate();
  let { senderCert } = makeCertChain(sender);
  let usmc = {
    type: CiphertextType.Whisper,
    sender: senderCert,
    content: new TextEncoder().encode("inner ciphertext bytes"),
    contentHint: ContentHint.Default,
  };
  let back = deserializeUSMC(serializeUSMC(usmc));
  expect(back.type).toBe(CiphertextType.Whisper);
  expect(back.contentHint).toBe(ContentHint.Default);
  expect(bytesToHex(back.content)).toBe(bytesToHex(usmc.content));
  expect(back.sender.senderUuid).toBe(senderCert.senderUuid);
});

// --- v1 round-trip ---

function makeUSMC(senderCert: SenderCertificate, text: string, hint = ContentHint.Resendable) {
  return {
    type: CiphertextType.Whisper,
    sender: senderCert,
    content: new TextEncoder().encode(text),
    contentHint: hint,
  };
}

test("Sealed Sender v1 round-trips: our encrypt → our decrypt recovers sender cert + content", () => {
  let sender = KeyPair.generate();
  let recipient = KeyPair.generate();
  let { senderCert } = makeCertChain(sender);
  let usmc = makeUSMC(senderCert, "hello via sealed sender v1");

  let blob = sealedSenderEncryptV1(usmc, sender, recipient.publicKey);
  expect(blob[0]).toBe(0x11);

  let result = sealedSenderDecrypt(blob, recipient, [trustRootPub], 1_699_999_999_000n);
  expect(result.sender.senderUuid).toBe(senderCert.senderUuid);
  expect(result.sender.senderDeviceId).toBe(3);
  expect(result.contentHint).toBe(ContentHint.Resendable);
  expect(new TextDecoder().decode(result.content)).toBe("hello via sealed sender v1");
});

test("Sealed Sender v1: wrong recipient key fails to decrypt", () => {
  let sender = KeyPair.generate();
  let recipient = KeyPair.generate();
  let { senderCert } = makeCertChain(sender);
  let blob = sealedSenderEncryptV1(makeUSMC(senderCert, "secret"), sender, recipient.publicKey);
  let attacker = KeyPair.generate();
  expect(() => sealedSenderDecryptToUSMC(blob, attacker)).toThrow();
});

test("Sealed Sender v1: tampering with the message ciphertext is rejected by the MAC", () => {
  let sender = KeyPair.generate();
  let recipient = KeyPair.generate();
  let { senderCert } = makeCertChain(sender);
  let blob = sealedSenderEncryptV1(makeUSMC(senderCert, "do not tamper"), sender, recipient.publicKey);
  blob[blob.length - 15] ^= 0x40; // flip a byte inside encryptedMessage
  expect(() => sealedSenderDecryptToUSMC(blob, recipient)).toThrow();
});

// --- v2 round-trip (single + multi recipient) ---

/** A 17-byte ACI ServiceId fixed-width binary: prefix 0x00 ‖ 16-byte UUID. */
function aciServiceId(uuid: string): Uint8Array {
  let hex = uuid.replace(/-/g, "");
  let out = new Uint8Array(17); // prefix byte stays 0 for ACI
  out.set(hexToBytes(hex), 1);
  return out;
}

function v2Recipient(identity: KeyPair, uuid: string): V2Recipient {
  return {
    identityKey: identity.publicKey,
    serviceId: aciServiceId(uuid),
    devices: [{ deviceId: 1, registrationId: 0x1234 }],
  };
}

test("Sealed Sender v2 round-trips for a single recipient (ReceivedMessage 0x22)", () => {
  let sender = KeyPair.generate();
  let recipient = KeyPair.generate();
  let { senderCert } = makeCertChain(sender);
  let usmc = makeUSMC(senderCert, "hello via sealed sender v2", ContentHint.Implicit);

  let received = sealedSenderEncryptV2Single(usmc, sender, v2Recipient(recipient, senderCert.senderUuid));
  expect(received[0]).toBe(0x22);

  let result = sealedSenderDecrypt(received, recipient, [trustRootPub], 1_699_999_999_000n);
  expect(result.sender.senderUuid).toBe(senderCert.senderUuid);
  expect(result.contentHint).toBe(ContentHint.Implicit);
  expect(new TextDecoder().decode(result.content)).toBe("hello via sealed sender v2");
});

test("Sealed Sender v2 multi-recipient: SentMessage 0x23 fans out, each recipient decrypts the shared content", () => {
  let sender = KeyPair.generate();
  let recip1 = KeyPair.generate();
  let recip2 = KeyPair.generate();
  let recip3 = KeyPair.generate();
  let { senderCert } = makeCertChain(sender);
  let usmc = makeUSMC(senderCert, "one body, three recipients");

  let recipients = [
    v2Recipient(recip1, "aaaaaaaa-0000-0000-0000-000000000001"),
    v2Recipient(recip2, "aaaaaaaa-0000-0000-0000-000000000002"),
    v2Recipient(recip3, "aaaaaaaa-0000-0000-0000-000000000003"),
  ];
  let sent = sealedSenderEncryptV2(usmc, sender, recipients);
  expect(sent.serialized[0]).toBe(0x23);

  let keys = [recip1, recip2, recip3];
  for (let i = 0; i < 3; i++) {
    let received = v2ReceivedMessageForRecipient(sent, i);
    let result = sealedSenderDecrypt(received, keys[i], [trustRootPub], 1_699_999_999_000n);
    expect(new TextDecoder().decode(result.content)).toBe("one body, three recipients");
    expect(result.sender.senderUuid).toBe(senderCert.senderUuid);
  }
});

test("Sealed Sender v2: a non-recipient cannot decrypt the message", () => {
  let sender = KeyPair.generate();
  let recipient = KeyPair.generate();
  let { senderCert } = makeCertChain(sender);
  let received = sealedSenderEncryptV2Single(makeUSMC(senderCert, "private"), sender, v2Recipient(recipient, senderCert.senderUuid));
  let attacker = KeyPair.generate();
  expect(() => sealedSenderDecryptToUSMC(received, attacker)).toThrow();
});

test("Sealed Sender v2: tampering with the AES-GCM-SIV ciphertext is rejected", () => {
  let sender = KeyPair.generate();
  let recipient = KeyPair.generate();
  let { senderCert } = makeCertChain(sender);
  let received = sealedSenderEncryptV2Single(makeUSMC(senderCert, "integrity"), sender, v2Recipient(recipient, senderCert.senderUuid));
  received[received.length - 1] ^= 0x01; // flip a byte in the shared ciphertext/tag
  expect(() => sealedSenderDecryptToUSMC(received, recipient)).toThrow();
});

test("Sealed Sender: decrypt rejects a forged sender certificate (untrusted chain)", () => {
  let sender = KeyPair.generate();
  let recipient = KeyPair.generate();
  // Sender cert signed by a server cert signed by a *forged* trust root.
  let forgedRoot = new Uint8Array(32).fill(9);
  let serverKey = KeyPair.generate();
  let serverCert = newServerCertificate(5, serverKey.publicKey, forgedRoot);
  let senderCert = newSenderCertificate({
    senderUuid: "ffffffff-0000-0000-0000-000000000000",
    senderIdentityKey: sender.publicKey,
    senderDeviceId: 1,
    expiration: 1_700_000_000_000n,
    signer: serverCert,
    signerPriv: serverKey.privateKey,
  });
  let blob = sealedSenderEncryptV1(makeUSMC(senderCert, "forged"), sender, recipient.publicKey);
  // The blob decrypts (recipient holds the key) but the chain must not validate.
  expect(() => sealedSenderDecrypt(blob, recipient, [trustRootPub], 1_699_999_999_000n)).toThrow();
  // To-USMC still works (no trust check there).
  expect(sealedSenderDecryptToUSMC(blob, recipient).sender.senderUuid).toBe("ffffffff-0000-0000-0000-000000000000");
});

// --- unidentified access key ---

test("deriveUnidentifiedAccessKey = AES-256-GCM(profileKey, 0¹², 0¹⁶)[:16]", async () => {
  // KAT computed independently via WebCrypto over the documented construction.
  let profileKey = new Uint8Array(32); // all-zero profile key
  let accessKey = await deriveUnidentifiedAccessKey(profileKey);
  expect(accessKey.length).toBe(16);
  // Reproduce the construction directly and compare.
  let k = await globalThis.crypto.subtle.importKey("raw", profileKey, "AES-GCM", false, ["encrypt"]);
  let ct = new Uint8Array(await globalThis.crypto.subtle.encrypt(
    { name: "AES-GCM", iv: new Uint8Array(12), tagLength: 128 }, k, new Uint8Array(16)));
  expect(bytesToHex(accessKey)).toBe(bytesToHex(ct.subarray(0, 16)));
});
