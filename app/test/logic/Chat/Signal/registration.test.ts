import { Registration, type VerificationSessionResponse, type RegistrationKeys } from "../../../../logic/Chat/Signal/Connection/Registration";
import { SignalApi } from "../../../../logic/Chat/Signal/Connection/SignalApi";
import { KeyPair } from "../../../../logic/Chat/Signal/Crypto/KeyPair";
import { generateSignedPreKey, generateRegistrationID } from "../../../../logic/Chat/Signal/Crypto/Identity";
import { KyberKeyPair } from "../../../../logic/Chat/Signal/Encryption/kyber";
import { xeddsaSign, djbDecode, xeddsaVerify } from "../../../../logic/Chat/Signal/Crypto/curve";
import { serializeKyberPublicKey } from "../../../../logic/Chat/Signal/Connection/keysJSON";
import { base64Decode } from "../../../../logic/Chat/Signal/Crypto/primitives";
import { expect, test } from "vitest";

/** A scripted SignalApi that records every request and returns canned responses
 * keyed by `METHOD path`. */
class FakeApi extends SignalApi {
  calls: { method: string, path: string, body?: any, creds?: any }[] = [];
  responses = new Map<string, any>();

  constructor() {
    super("https://chat.signal.org");
  }
  override async json<T = any>(method: string, path: string, body?: any, creds?: any): Promise<T> {
    this.calls.push({ method, path, body, creds });
    let key = `${method} ${path.split("?")[0]}`;
    let r = this.responses.get(key);
    if (typeof r == "function") {
      r = r(body);
    }
    return r as T;
  }
}

function makeKeys(): RegistrationKeys {
  let aciIdentity = KeyPair.generate();
  let pniIdentity = KeyPair.generate();
  return {
    aciIdentity, pniIdentity,
    aciSignedPreKey: generateSignedPreKey(aciIdentity, 1),
    pniSignedPreKey: generateSignedPreKey(pniIdentity, 1),
    aciKyberLastResort: { keyID: 1, keyPair: KyberKeyPair.generate(), signature: new Uint8Array(64) },
    pniKyberLastResort: { keyID: 1, keyPair: KyberKeyPair.generate(), signature: new Uint8Array(64) },
    aciRegistrationId: generateRegistrationID(),
    pniRegistrationId: generateRegistrationID(),
    profileKey: new Uint8Array(32).fill(9),
  };
}

function session(over: Partial<VerificationSessionResponse>): VerificationSessionResponse {
  return {
    id: "SESS", nextSms: null, nextCall: null, nextVerificationAttempt: null,
    allowedToRequestCode: false, requestedInformation: [], verified: false, ...over,
  };
}

test("verification-session state machine: create → captcha → request → submit", async () => {
  let api = new FakeApi();
  api.responses.set("POST /v1/verification/session", session({ requestedInformation: ["captcha"] }));
  api.responses.set("PATCH /v1/verification/session/SESS", session({ allowedToRequestCode: true }));
  api.responses.set("POST /v1/verification/session/SESS/code", session({ allowedToRequestCode: true }));
  api.responses.set("PUT /v1/verification/session/SESS/code", session({ verified: true }));

  let reg = new Registration("+15551234567", {
    getCaptcha: async () => "captcha-token",
    getSmsCode: async () => "123456",
  }, api);

  let result = await reg.verifySession();
  expect(result.verified).toBe(true);

  let paths = api.calls.map(c => `${c.method} ${c.path}`);
  expect(paths).toEqual([
    "POST /v1/verification/session",
    "PATCH /v1/verification/session/SESS",
    "POST /v1/verification/session/SESS/code",
    "PUT /v1/verification/session/SESS/code",
  ]);

  // The create carried the number; captcha carried the token; code request asked SMS.
  expect(api.calls[0].body).toEqual({ number: "+15551234567" });
  expect(api.calls[1].body).toEqual({ captcha: "captcha-token" });
  expect(api.calls[2].body).toEqual({ transport: "sms", client: "android-2021-03" });
  expect(api.calls[3].body).toEqual({ code: "123456" });
});

test("session with no challenge skips the captcha PATCH", async () => {
  let api = new FakeApi();
  api.responses.set("POST /v1/verification/session", session({ allowedToRequestCode: true }));
  api.responses.set("POST /v1/verification/session/SESS/code", session({ allowedToRequestCode: true }));
  api.responses.set("PUT /v1/verification/session/SESS/code", session({ verified: true }));

  let reg = new Registration("+15550000000", {
    getCaptcha: async () => { throw new Error("should not be called"); },
    getSmsCode: async () => "000000",
  }, api);
  await reg.verifySession();
  expect(api.calls.some(c => c.method == "PATCH")).toBe(false);
});

test("a rejected code throws", async () => {
  let api = new FakeApi();
  api.responses.set("POST /v1/verification/session", session({ allowedToRequestCode: true }));
  api.responses.set("POST /v1/verification/session/SESS/code", session({ allowedToRequestCode: true }));
  api.responses.set("PUT /v1/verification/session/SESS/code", session({ verified: false }));

  let reg = new Registration("+15550000000", {
    getCaptcha: async () => "x", getSmsCode: async () => "999999",
  }, api);
  await expect(reg.verifySession()).rejects.toThrow(/rejected/);
});

test("a server that keeps asking for another captcha stops asking the user after a few, and throws", async () => {
  let api = new FakeApi();
  api.responses.set("POST /v1/verification/session", session({ requestedInformation: ["captcha"] }));
  api.responses.set("PATCH /v1/verification/session/SESS", session({ requestedInformation: ["captcha"] }));
  let captchas = 0;

  let reg = new Registration("+15550000000", {
    getCaptcha: async () => "captcha-" + captchas++, getSmsCode: async () => "000000",
  }, api);
  await expect(reg.verifySession()).rejects.toThrow();
  // More than any real registration needs. A client that asks more often is stuck.
  expect(captchas).toBeLessThanOrEqual(10);
  expect(api.calls.some(c => c.path.endsWith("/code"))).toBe(false);
});

test("registration body: atomic ACI/PNI keys, attributes, capabilities, UAK", async () => {
  let api = new FakeApi();
  let keys = makeKeys();
  // Re-sign the last-resort keys so the signature actually verifies below.
  keys.aciKyberLastResort.signature = xeddsaSign(keys.aciIdentity.privateKey, serializeKyberPublicKey(keys.aciKyberLastResort.keyPair.publicKey));

  let reg = new Registration("+15551112222", { getCaptcha: async () => "", getSmsCode: async () => "" }, api);
  reg.password = "PW";
  let body = await reg.registrationBody("SESS", keys, { spqr: true, storage: true });

  expect(body.sessionId).toBe("SESS");
  expect(body.skipDeviceTransfer).toBe(true);
  expect(body.accountAttributes.fetchesMessages).toBe(true);
  expect(body.accountAttributes.registrationId).toBe(keys.aciRegistrationId);
  expect(body.accountAttributes.pniRegistrationId).toBe(keys.pniRegistrationId);
  expect(body.accountAttributes.name).toBe(null);
  expect(body.accountAttributes.capabilities.spqr).toBe(true);
  // unidentifiedAccessKey is 16 bytes (derived from the profile key).
  expect(base64Decode(body.accountAttributes.unidentifiedAccessKey).length).toBe(16);

  // Identity keys: 33-byte DJB.
  expect(base64Decode(body.aciIdentityKey).length).toBe(33);
  expect(base64Decode(body.pniIdentityKey).length).toBe(33);

  // The ACI Kyber last-resort signature verifies over the serialized key + ACI identity.
  expect(xeddsaVerify(
    djbDecode(base64Decode(body.aciIdentityKey)),
    serializeKyberPublicKey(keys.aciKyberLastResort.keyPair.publicKey),
    base64Decode(body.aciPqLastResortPreKey.signature))).toBe(true);
  expect(base64Decode(body.aciPqLastResortPreKey.publicKey).length).toBe(1569);
});

test("createAccount uses Basic auth e164:password", async () => {
  let api = new FakeApi();
  api.responses.set("POST /v1/registration", { uuid: "u", number: "+1", pni: "p" });
  let reg = new Registration("+15551112222", { getCaptcha: async () => "", getSmsCode: async () => "" }, api);
  reg.password = "secret-pw";
  await reg.createAccount("SESS", makeKeys(), { spqr: true });
  let call = api.calls.find(c => c.path == "/v1/registration")!;
  expect(call.creds).toEqual({ username: "+15551112222", password: "secret-pw" });
});
