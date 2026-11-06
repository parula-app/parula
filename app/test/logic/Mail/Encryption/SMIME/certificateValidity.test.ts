import "../../../../../logic/app";
import { setupTestFolder } from "../../SQL/setup";
import { SMIMEPublicKey, KeyStatus } from "../../../../../logic/Mail/Encryption/SMIME/SMIMEPublicKey";
import { getPublicKeyByKeyID } from "../../../../../logic/Mail/Encryption/KeyUtils";
import { TrustLevel } from "../../../../../logic/Mail/Encryption/enums";
import type { EMail } from "../../../../../logic/Mail/EMail";
import type { Folder } from "../../../../../logic/Mail/Folder";
import { kRootCA, kIntermediateCA, kExpiredIntermediateCA, kAliceCertificate, kSignedByAlice } from "./certificateValidity";
import { expect, test, describe, beforeAll, afterEach, vi } from "vitest";

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

let folder: Folder;

beforeAll(async () => {
  // `SMIMEPublicKey` caches the CA certificates per process,
  // so this is the same for all tests in this file.
  ({ folder } = await setupTestFolder({
    getCACertificates: async (type: string) => type == "bundled" ? [kRootCA] : [],
  }));
});

afterEach(() => {
  vi.useRealTimers();
});

function setToday(date: string) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(date));
}

describe("Validity dates of the certificate and its chain", () => {
  test("A certificate within its validity period is valid", async () => {
    setToday("2026-10-22T12:00:00Z");
    let key = await SMIMEPublicKey.importPublicKey(kAliceCertificate + kIntermediateCA);
    expect(await key.keyStatus()).toBe(KeyStatus.Valid);
    expect(key.trustLevel).toBe(TrustLevel.ThirdParty);
  });

  test("An expired certificate is not valid", async () => {
    setToday("2026-12-15T12:00:00Z");
    let key = await SMIMEPublicKey.importPublicKey(kAliceCertificate + kIntermediateCA);
    expect(await key.keyStatus()).toBe(KeyStatus.Expired);
    expect(key.trustLevel).toBe(TrustLevel.Sender);
  });

  test("A certificate that is not yet valid is not valid", async () => {
    setToday("2026-09-15T12:00:00Z");
    let key = await SMIMEPublicKey.importPublicKey(kAliceCertificate + kIntermediateCA);
    expect(await key.keyStatus()).toBe(KeyStatus.Expired);
    expect(key.trustLevel).toBe(TrustLevel.Sender);
  });

  test("An expired intermediate certificate makes the certificate invalid", async () => {
    setToday("2026-11-20T12:00:00Z");
    let key = await SMIMEPublicKey.importPublicKey(kAliceCertificate + kExpiredIntermediateCA);
    expect(await key.keyStatus()).not.toBe(KeyStatus.Valid);
    expect(key.trustLevel).toBe(TrustLevel.Sender);
  });

  test("An intermediate certificate that expired since then is valid at a time before it expired", async () => {
    setToday("2026-11-20T12:00:00Z"); // only the intermediate certificate expired, on 2026-11-15
    let key = await SMIMEPublicKey.importPublicKey(kAliceCertificate + kExpiredIntermediateCA);
    expect(await key.keyStatus(new Date("2026-10-22T12:00:00Z"))).toBe(KeyStatus.Valid);
    expect(key.trustLevel).toBe(TrustLevel.ThirdParty);
  });

  test("An intermediate certificate that is obsolete for another reason than its dates makes the certificate invalid", async () => {
    setToday("2026-10-22T12:00:00Z");
    let key = await SMIMEPublicKey.importPublicKey(kAliceCertificate + kIntermediateCA);
    // e.g. disabled by the user or revoked, while within its validity dates
    key.chain.first.obsolete = true;
    expect(await key.keyStatus()).not.toBe(KeyStatus.Valid);
    expect(key.trustLevel).toBe(TrustLevel.Sender);
  });

  test("An expired certificate is obsolete, so it is not used for new mail", async () => {
    setToday("2026-12-15T12:00:00Z"); // Alice's certificate expired, the intermediate certificate did not
    let key = await SMIMEPublicKey.importPublicKey(kAliceCertificate + kIntermediateCA);
    expect(key.obsolete).toBe(true);
    expect(key.chain.first.obsolete).toBe(false);
  });
});

describe("The signature counts as valid only if the certificate was valid when the message arrived", () => {
  async function readMessage(received: string): Promise<EMail> {
    let email = folder.newEMail();
    email.received = new Date(received);
    email.mime = new TextEncoder().encode(kSignedByAlice.replace(/\n/g, "\r\n"));
    await email.parseMIME();
    return email;
  }

  test("A message that arrived while the certificate was valid stays valid after it expired", async () => {
    setToday("2027-02-01T12:00:00Z"); // both Alice's and the intermediate certificate expired
    let email = await readMessage("2026-10-22T12:00:00Z");
    let key = await getPublicKeyByKeyID(email.signedByKeyID, email);
    expect(key.trustLevel).toBe(TrustLevel.ThirdParty);
    expect(key.isValidAt(email.received)).toBe(true);
  });

  test("A message that arrived after the certificate expired is not valid, although it was signed before", async () => {
    setToday("2026-12-15T12:00:00Z");
    let email = await readMessage("2026-12-15T12:00:00Z");
    let key = await getPublicKeyByKeyID(email.signedByKeyID, email);
    expect(key.trustLevel).toBe(TrustLevel.Sender);
    expect(key.isValidAt(email.received)).toBe(false);
  });
});
