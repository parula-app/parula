import { WireTransport, WireError, WireRateLimitError } from "./WireTransport";
import { WireSSO } from "./WireSSO";
import { kDeviceClass, deviceLabel, deviceModel } from "./clientInfo";
import type { TWirePrekey } from "./TWire";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { RunOnce } from "../../util/flow/RunOnce";
import { assert, ensureArray } from "../../util/util";

/** Logs in, keeps the access token fresh, and registers our device.
 *
 * The 3 secrets, in decreasing order of lifetime: the password, which we never
 * store and forget as soon as `POST /clients` consumed it; the `zuid` cookie,
 * which is the credential that survives restarts and, for an SSO account, the
 * only one we will ever have; and the access token, which lives ~15 minutes and
 * only in memory. */
export class WireSession {
  readonly transport: WireTransport;
  /** Our own user ID, and the domain that qualifies it */
  userID: string;
  domain: string;
  /** Our device. Wire encrypts per device, so this, not the user ID, is our
   * messaging identity. Created once, then only checked to still exist. */
  clientID: string | null = null;
  /** Tags the cookie and the device as ours. Issuing a cookie with this label
   * revokes our previous one, which keeps repeated logins from filling up the
   * user's 32-cookie budget. Per installation, so it is persisted. */
  cookieLabel: string = crypto.randomUUID();
  emailAddress: string | null = null;
  /** Which protocols the backend currently tells our peers that we speak.
   * Read from `/self`, and only ever added to: `mls` cannot be taken back. */
  publishedProtocols: string[] = [];
  /** Asked for when the backend demands a 2FA code. Set by the account. */
  onVerificationCode: (() => Promise<string>) | null = null;
  refreshErrorCallback = (ex: Error) => console.error(ex);
  readonly sso: WireSSO;
  /** Only in memory, only until `POST /clients` consumed them */
  protected password: string | null = null;
  protected verificationCode: string | null = null;
  protected refreshOnce = new RunOnce<void>();
  protected refreshTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(transport: WireTransport) {
    this.transport = transport;
    this.transport.onTokenExpired = async () => await this.refreshToken();
    this.sso = new WireSSO(this);
  }

  /** Email address + password. Handles the 2FA round trip via `onVerificationCode`. */
  async loginWithPassword(emailAddress: string, password: string): Promise<void> {
    await this.ensureVersion();
    this.emailAddress = emailAddress.trim();
    this.password = password;
    this.setAccessToken(await this.postLogin());
    await this.readSelf();
  }

  /** SSO. Opens the browser flow and waits for the cookie.
   * @param code The team's login code `wire-<uuid>`, or the bare IdP ID */
  async loginWithSSO(code: string): Promise<void> {
    await this.ensureVersion();
    this.sso.code = code;
    await this.sso.loginWithUI();
    await this.readSelf();
  }

  /** From the stored cookie, at startup. No user interaction. */
  async resume(): Promise<void> {
    assert(this.transport.cookie, "Wire: Need the login cookie to resume");
    await this.ensureVersion();
    await this.refreshToken();
    await this.readSelf();
  }

  /** `POST /access`, unversioned, with the cookie. Also rotates the cookie.
   * Callers that all notice the expiry at once share the one refresh. */
  async refreshToken(): Promise<void> {
    await this.refreshOnce.runOnce(async () => await this.postAccess());
  }

  async logout(): Promise<void> {
    this.stop();
    try {
      await this.transport.post("/access/logout", null,
        { unversioned: true, withCookie: true, noRetryOnExpiry: true });
    } catch (ex) {
      console.error(ex); // The cookie may already be dead. Drop it locally either way.
    }
    this.transport.accessToken = null;
    this.transport.cookie = null;
    this.forgetPassword();
  }

  /** Stops the token refresh. Call before dropping this object. */
  stop() {
    clearTimeout(this.refreshTimeout);
    this.refreshTimeout = null;
  }

  /** Registers this device if we do not have one yet, else verifies ours is still
   * there. Uploads the MLS signature public key.
   * @param prekeys Proteus prekeys, which the backend demands even from an
   *   MLS-only client, so whoever owns the Proteus keys passes them in.
   * @param lastPrekey the last-resort prekey, which must have the ID 0xFFFF
   * @throws WireTooManyClientsError, if the user must delete a device first */
  async ensureClient(mlsPublicKeys: Record<string, string>,
    prekeys?: TWirePrekey[], lastPrekey?: TWirePrekey): Promise<void> {
    if (!this.clientID || !await this.haveClient()) {
      this.clientID = await this.registerClient(mlsPublicKeys, prekeys, lastPrekey);
    }
    // Binds the cookie to our device. The access token then carries the client ID.
    await this.postAccess();
    this.forgetPassword();
  }

  /** Removes one of our user's devices, e.g. to make room for ours after a
   * `WireTooManyClientsError`. */
  async deleteClient(clientID: string): Promise<void> {
    await this.transport.delete(`/clients/${clientID}`,
      this.password ? { password: this.password } : {});
  }

  /** Our user's devices, oldest first, as the user picks one to delete */
  async listClients(): Promise<any[]> {
    let clients = ensureArray(await this.transport.get("/clients"));
    return clients.sort((a, b) => sanitize.string(a?.time, "") < sanitize.string(b?.time, "") ? -1 : 1);
  }

  protected async ensureVersion(): Promise<void> {
    if (!this.transport.version) {
      await this.transport.negotiateVersion();
    }
  }

  protected async postLogin(isRetry = false): Promise<any> {
    let login: any = {
      email: this.emailAddress,
      password: this.password,
      label: this.cookieLabel,
    };
    if (this.verificationCode) {
      login.verification_code = this.verificationCode;
    }
    try {
      // A persistent cookie is the one that gets renewed, so that we stay logged in.
      return await this.transport.post("/login", login, { query: { persist: true } });
    } catch (ex) {
      if (!(ex instanceof WireError) || ex.label != "code-authentication-required" || isRetry) {
        throw ex;
      }
      await this.askVerificationCode();
      return await this.postLogin(true);
    }
  }

  /** 2FA: the backend mails a 6-digit code. The *same* code is needed a second
   * time for `POST /clients`, so we keep it until that consumed it. */
  protected async askVerificationCode(): Promise<void> {
    assert(this.onVerificationCode, "Wire: Need a way to ask for the verification code");
    try {
      await this.transport.post("/verification-code/send",
        { email: this.emailAddress, action: "login" });
    } catch (ex) {
      // Throttled: a code was mailed a moment ago. Let the user type that one.
      if (!(ex instanceof WireRateLimitError)) {
        throw ex;
      }
    }
    this.verificationCode = sanitize.string(await this.onVerificationCode(), null);
  }

  /** `POST /access`: a new access token, and the cookie rotated.
   * Our client ID, once we have one, binds the cookie to our device forever. */
  protected async postAccess(): Promise<void> {
    let json = await this.transport.post("/access", null, {
      unversioned: true,
      withCookie: true,
      noRetryOnExpiry: true, // this *is* the refresh
      query: this.clientID ? { client_id: this.clientID } : undefined,
    });
    this.setAccessToken(json);
  }

  protected setAccessToken(json: any) {
    this.transport.accessToken = sanitize.nonemptystring(json.access_token);
    this.userID ??= sanitize.nonemptystring(json.user, null);
    this.refreshIn(sanitize.integer(json.expires_in, 0));
  }

  /** Refresh before the token expires, so that no call has to fail first.
   * The server may still revoke it early, which the 401 retry then catches. */
  protected refreshIn(seconds: number) {
    clearTimeout(this.refreshTimeout);
    if (seconds <= 0) {
      return;
    }
    let delay = Math.max(seconds - kRefreshAheadSeconds, seconds / 2);
    this.refreshTimeout = setTimeout(() =>
      this.refreshToken().catch(this.refreshErrorCallback), delay * 1000);
  }

  /** Our own user. The only place that tells us our domain, which every
   * federated ID needs. */
  protected async readSelf(): Promise<void> {
    let json = await this.transport.get("/self");
    this.userID = sanitize.nonemptystring(json.qualified_id?.id ?? json.id);
    this.domain = sanitize.hostname(json.qualified_id?.domain ?? this.transport.domain, null);
    this.emailAddress = sanitize.emailAddress(json.email, this.emailAddress);
    this.publishedProtocols = sanitize.array(json.supported_protocols, []) as string[];
  }

  /** Whether every device of ours can read MLS. Until they all can, telling
   * our peers that we speak it would send MLS to a device that cannot. */
  async allDevicesHaveMLS(): Promise<boolean> {
    let clients = ensureArray(await this.transport.get("/clients"));
    return clients.every(client => Object.keys(client?.mls_public_keys ?? {}).length > 0);
  }

  /** Whether the device we registered earlier is still listed for our user.
   * If it is gone, the user deleted it elsewhere, together with its key material. */
  protected async haveClient(): Promise<boolean> {
    let clients = ensureArray(await this.transport.get("/clients"));
    return clients.some(client => sanitize.string(client?.id, null) == this.clientID);
  }

  /** @returns the client ID that the backend assigned to our device */
  protected async registerClient(mlsPublicKeys: Record<string, string>,
    prekeys: TWirePrekey[] | undefined, lastPrekey: TWirePrekey | undefined,
    isRetry = false): Promise<string> {
    let newClient: any = {
      type: "permanent",
      class: kDeviceClass,
      label: deviceLabel(),
      model: deviceModel(),
      cookie: this.cookieLabel,
      capabilities: kClientCapabilities,
      prekeys: prekeys ?? [],
      lastkey: lastPrekey,
      mls_public_keys: mlsPublicKeys,
    };
    if (this.password) { // Needed from the 2nd device onwards. SSO users have none.
      newClient.password = this.password;
    }
    if (this.verificationCode) {
      newClient.verification_code = this.verificationCode;
    }
    try {
      let json = await this.transport.post("/clients", newClient);
      return sanitize.nonemptystring(json.id);
    } catch (ex) {
      if (!(ex instanceof WireError) || isRetry) {
        throw ex;
      }
      if (ex.label == "too-many-clients") {
        // We are logged in – only the device registration failed. The user decides.
        throw new WireTooManyClientsError(ex, await this.listClients());
      }
      if (ex.label != "code-authentication-required") {
        throw ex;
      }
      await this.askVerificationCode();
      return await this.registerClient(mlsPublicKeys, prekeys, lastPrekey, true);
    }
  }

  protected forgetPassword() {
    this.password = null;
    this.verificationCode = null;
  }

  toJSON(): any {
    return {
      userID: this.userID,
      domain: this.domain,
      clientID: this.clientID,
      cookie: this.transport.cookie,
      cookieLabel: this.cookieLabel,
      apiVersion: this.transport.version,
    };
  }

  fromJSON(json: any): void {
    this.userID = sanitize.string(json.userID, null);
    this.domain = sanitize.hostname(json.domain, null);
    this.clientID = sanitize.string(json.clientID, null);
    this.cookieLabel = sanitize.string(json.cookieLabel, null) ?? this.cookieLabel;
    this.transport.cookie = sanitize.string(json.cookie, null);
    this.transport.version = sanitize.integer(json.apiVersion, null);
  }
}

/** The user has as many devices as the backend allows (7, by default), so ours
 * could not be registered. We *are* logged in. The user must pick one of
 * `clients` for `deleteClient()`, then `ensureClient()` can try again.
 * Never delete one by ourselves: that destroys the messages on that device. */
export class WireTooManyClientsError extends WireError {
  /** Our user's devices, oldest first */
  readonly clients: any[];

  constructor(ex: WireError, clients: any[]) {
    super(ex.httpCode, ex.label, ex.serverMessage, ex.data);
    this.clients = clients;
  }
}

/** `legalhold-implicit-consent`: without it, the backend blocks us out of every
 * conversation that has a legal-hold device in it. `consumable-notifications`
 * is deliberately absent: we read the notification stream the paged way. */
const kClientCapabilities = ["legalhold-implicit-consent"];
const kRefreshAheadSeconds = 60;
