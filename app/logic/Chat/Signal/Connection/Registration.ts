/** New-account registration as a primary device (Docs/02 §A). Drives the
 * verification-session state machine on the chat server, then POSTs the atomic
 * account-creation request with the account attributes and the ACI + PNI identity
 * keys, signed prekeys and Kyber last-resort prekeys.
 *
 * The crypto (identity keys, prekeys, profile key, unidentified-access key) is the
 * verified Crypto/Encryption code; this module is the REST/JSON orchestration. The
 * caller (`SignalAccount.registerNewAccount`) supplies the freshly built stores so
 * the same key material is persisted on the account and published via `/v2/keys`. */
import { SignalApi, SignalHosts, type Credentials } from "./SignalApi";
import {
  ecSignedPreKeyJSON, kemSignedPreKeyJSON, base64NoPad,
  type ECSignedPreKeyJSON, type KEMSignedPreKeyJSON,
} from "./keysJSON";
import type { SignedPreKey } from "../Crypto/Identity";
import type { KyberKeyPair } from "../Encryption/kyber";
import { KeyPair } from "../Crypto/KeyPair";
import { djbEncode } from "../Crypto/curve";
import { deriveUnidentifiedAccessKey } from "../Encryption/SealedSender";
import { LoopGuard } from "../../../util/flow/LoopGuard";

/** The two challenge kinds a verification session may demand (Docs/02 §A.2). */
export type RequestedInformation = "captcha" | "pushChallenge";

/** The server's `VerificationSessionResponse` (Docs/02 §A.2). */
export interface VerificationSessionResponse {
  id: string;
  nextSms: number | null;
  nextCall: number | null;
  nextVerificationAttempt: number | null;
  allowedToRequestCode: boolean;
  requestedInformation: RequestedInformation[];
  verified: boolean;
}

/** The server's `AccountCreationResponse` (Docs/02 §A.4). */
export interface AccountCreationResponse {
  uuid: string;        // the ACI
  number: string;      // E164
  pni: string;         // the PNI uuid
  usernameHash?: string | null;
  storageCapable?: boolean;
  reregistration?: boolean;
}

/** A device's Kyber last-resort prekey (keyID + keypair). */
export interface KyberLastResort {
  keyID: number;
  keyPair: KyberKeyPair;
  signature: Uint8Array;
}

/** Everything the account-creation POST needs beyond the session + attributes. */
export interface RegistrationKeys {
  aciIdentity: KeyPair;
  pniIdentity: KeyPair;
  aciSignedPreKey: SignedPreKey;
  pniSignedPreKey: SignedPreKey;
  aciKyberLastResort: KyberLastResort;
  pniKyberLastResort: KyberLastResort;
  aciRegistrationId: number;
  pniRegistrationId: number;
  profileKey: Uint8Array;
}

/** Capability flags a new primary must advertise (Docs/02 §A.4; `spqr` required). */
export interface Capabilities {
  [name: string]: boolean;
}

/** Callbacks the UI supplies to satisfy the session challenges + verify the SMS. */
export interface RegistrationCallbacks {
  /** Resolve an opaque captcha token (the hCaptcha/reCAPTCHA flow). */
  getCaptcha: () => Promise<string>;
  /** Resolve the numeric verification code the user received via SMS. */
  getSmsCode: () => Promise<string>;
}

/** Drives the registration flow end to end (Docs/02 §A): session → captcha →
 * request SMS → submit code → POST /v1/registration. */
export class Registration {
  protected readonly api: SignalApi;

  constructor(
    protected readonly e164: string,
    protected readonly callbacks: RegistrationCallbacks,
    api?: SignalApi,
  ) {
    this.api = api ?? new SignalApi(SignalHosts.chat);
  }

  /** Run the verification-session state machine to a `verified:true` session, then
   * create the account. @returns the parsed AccountCreationResponse. */
  async run(keys: RegistrationKeys, capabilities: Capabilities): Promise<AccountCreationResponse> {
    let session = await this.verifySession();
    return await this.createAccount(session.id, keys, capabilities);
  }

  /** POST a session, satisfy its requested challenges, request the SMS code, and
   * submit it — looping until the session is `verified`. */
  async verifySession(): Promise<VerificationSessionResponse> {
    let session = await this.createSession();
    session = await this.satisfyChallenges(session);
    if (!session.allowedToRequestCode) {
      throw new Error("Signal registration: session never became allowed to request a code");
    }
    await this.requestCode(session.id);
    return await this.submitCode(session.id);
  }

  /** Endpoint 1 — POST /v1/verification/session (no auth). */
  async createSession(): Promise<VerificationSessionResponse> {
    return await this.api.json<VerificationSessionResponse>(
      "POST", "/v1/verification/session", { number: this.e164 });
  }

  /** Submit a captcha for each pending challenge until the session is allowed to
   * request a code (a captcha alone satisfies the push challenge too, §A.2). */
  async satisfyChallenges(session: VerificationSessionResponse): Promise<VerificationSessionResponse> {
    let loop = new LoopGuard(5, () => {
      throw new Error("Signal registration: The server keeps asking for another captcha. Stopped.");
    });
    while (!session.allowedToRequestCode && session.requestedInformation.length && loop.nextRound()) {
      if (session.requestedInformation.includes("captcha")) {
        session = await this.submitCaptcha(session.id, await this.callbacks.getCaptcha());
      } else {
        // Only a push challenge remains, which we can't satisfy headless here.
        throw new Error("Signal registration: session requires a push challenge we can't satisfy");
      }
    }
    return session;
  }

  /** Endpoint 2 — PATCH /v1/verification/session/{id} with a captcha token. */
  async submitCaptcha(sessionId: string, captcha: string): Promise<VerificationSessionResponse> {
    return await this.api.json<VerificationSessionResponse>(
      "PATCH", `/v1/verification/session/${sessionId}`, { captcha });
  }

  /** Endpoint 3 — POST …/{id}/code, asking for an SMS. */
  async requestCode(sessionId: string): Promise<VerificationSessionResponse> {
    return await this.api.json<VerificationSessionResponse>(
      "POST", `/v1/verification/session/${sessionId}/code`, { transport: "sms", client: "android-2021-03" });
  }

  /** Endpoint 4 — PUT …/{id}/code, submitting the user's code. Throws if the code
   * was wrong (the server returns 200 with `verified:false`). */
  async submitCode(sessionId: string): Promise<VerificationSessionResponse> {
    let code = await this.callbacks.getSmsCode();
    let session = await this.api.json<VerificationSessionResponse>(
      "PUT", `/v1/verification/session/${sessionId}/code`, { code });
    if (!session.verified) {
      throw new Error("Signal registration: verification code rejected");
    }
    return session;
  }

  /** §A.4 — POST /v1/registration (Basic auth e164:password). The signed/last-resort
   * prekeys for both ACI and PNI are uploaded atomically here; one-time prekeys go
   * out afterward via /v2/keys. */
  async createAccount(sessionId: string, keys: RegistrationKeys, capabilities: Capabilities): Promise<AccountCreationResponse> {
    let body = await this.registrationBody(sessionId, keys, capabilities);
    let creds: Credentials = { username: this.e164, password: this.password };
    return await this.api.json<AccountCreationResponse>("POST", "/v1/registration", body, creds);
  }

  /** The freshly chosen service password (becomes the primary device's password). */
  password = "";

  /** Build the `RegistrationRequest` JSON (Docs/02 §A.4). */
  async registrationBody(sessionId: string, keys: RegistrationKeys, capabilities: Capabilities): Promise<RegistrationRequestJSON> {
    let unidentifiedAccessKey = base64NoPad(await deriveUnidentifiedAccessKey(keys.profileKey));
    return {
      sessionId,
      skipDeviceTransfer: true,
      accountAttributes: {
        fetchesMessages: true,
        registrationId: keys.aciRegistrationId,
        pniRegistrationId: keys.pniRegistrationId,
        name: null,
        capabilities,
        unidentifiedAccessKey,
        unrestrictedUnidentifiedAccess: false,
        discoverableByPhoneNumber: true,
      },
      aciIdentityKey: base64NoPad(djbEncode(keys.aciIdentity.publicKey)),
      pniIdentityKey: base64NoPad(djbEncode(keys.pniIdentity.publicKey)),
      aciSignedPreKey: ecSignedPreKeyJSON(keys.aciSignedPreKey),
      pniSignedPreKey: ecSignedPreKeyJSON(keys.pniSignedPreKey),
      aciPqLastResortPreKey: kemSignedPreKeyJSON(keys.aciKyberLastResort.keyID, keys.aciKyberLastResort.keyPair, keys.aciIdentity),
      pniPqLastResortPreKey: kemSignedPreKeyJSON(keys.pniKyberLastResort.keyID, keys.pniKyberLastResort.keyPair, keys.pniIdentity),
    };
  }
}

/** The account-creation request JSON (Docs/02 §A.4). */
export interface RegistrationRequestJSON {
  sessionId: string;
  skipDeviceTransfer: boolean;
  accountAttributes: {
    fetchesMessages: boolean;
    registrationId: number;
    pniRegistrationId: number;
    name: string | null;
    capabilities: Capabilities;
    unidentifiedAccessKey: string;
    unrestrictedUnidentifiedAccess: boolean;
    discoverableByPhoneNumber: boolean;
  };
  aciIdentityKey: string;
  pniIdentityKey: string;
  aciSignedPreKey: ECSignedPreKeyJSON;
  pniSignedPreKey: ECSignedPreKeyJSON;
  aciPqLastResortPreKey: KEMSignedPreKeyJSON;
  pniPqLastResortPreKey: KEMSignedPreKeyJSON;
}

/** Thin facade: build a {@link Registration}, set its password, run it. The account
 * builds the stores + supplies the keys; this orchestrates the REST flow. */
export async function registerNewAccount(
  e164: string, password: string, keys: RegistrationKeys, capabilities: Capabilities,
  callbacks: RegistrationCallbacks, api?: SignalApi,
): Promise<AccountCreationResponse> {
  let reg = new Registration(e164, callbacks, api);
  reg.password = password;
  return await reg.run(keys, capabilities);
}
