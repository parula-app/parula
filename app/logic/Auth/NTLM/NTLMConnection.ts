import { NTLMResponse, joinHeader, type NTLMRequestOptions } from "./NTLMResponse";
import type { EWSAccount } from "../../Mail/EWS/EWSAccount";
import { LoginError } from "../../Abstract/Account";
import { appGlobal } from "../../app";
import { retryOnTransientError } from "../../util/netUtil";
import { Lock } from "../../util/flow/Lock";
import { Timeout } from "../../util/flow/Timeout";
import { assert, waitTime } from "../../util/util";
import { gt } from "../../../l10n/l10n";

/**
 * A single HTTP connection to a server that uses NTLM authentication.
 *
 * NTLM authenticates the TCP connection, not the HTTP request:
 * 1. We send a Type 1 (negotiate) message and get a 401 with the
 *    Type 2 message (server challenge) back.
 * 2. We answer the challenge with a Type 3 (login) message, which rides
 *    on the first real request. So a fresh connection costs exactly one
 *    extra round trip.
 * 3. All later requests on the same TCP connection are authenticated
 *    without any `Authorization` header.
 *
 * Both handshake steps and all later requests must run on the same
 * TCP connection. The backend `HTTPConnection` guarantees a single
 * connection and reports which connection served each response
 * (`socketID`), so we always *know* whether our login applies, instead
 * of guessing. Whenever the server closed the connection and a request
 * ran on a new one, we see the changed `socketID` and re-authenticate.
 *
 * One request at a time per connection. For parallel requests, use
 * multiple connections, see `NTLMConnectionPool`.
 */
export class NTLMConnection {
  protected readonly account: EWSAccount;
  protected readonly cookies: CookieJar;
  /** Backend `HTTPConnection` (via JPC) */
  protected conn: any = null;
  /** `socketID` of the TCP connection that we logged in to. 0 = none. */
  protected authenticatedSocketID = 0;
  protected readonly lock = new Lock();
  /** from `NTLMConnectionPool` */
  protected readonly handshakeLock: Lock;

  constructor(account: EWSAccount, cookies?: CookieJar, handshakeLock?: Lock) {
    this.account = account;
    this.cookies = cookies ?? new CookieJar();
    this.handshakeLock = handshakeLock ?? new Lock();
  }

  /**
   * POSTs to the account URL over this connection, transparently
   * authenticating the TCP connection as needed.
   * To abort a request, `close()` the connection.
   * @param onChunk Streams a 2xx response body instead of returning it:
   *   Called for each chunk, in order. The promise resolves once the
   *   response ended. Non-2xx responses are still returned whole.
   * @throws LoginError if the server rejected the credentials
   */
  async request(body: string, options: NTLMRequestOptions = {}): Promise<NTLMResponse> {
    let locked = await this.lock.lock();
    try {
      this.conn ??= await appGlobal.remoteApp.newHTTPConnection(this.account.url,
        { acceptBrokenTLSCerts: this.account.acceptBrokenTLSCerts });
      // The login can fail for transient reasons, e.g. the server closed the
      // connection during the handshake. Then log in again and repeat, once.
      return await this.requestOnce(body, options, true) ??
        await this.requestOnce(body, options, false);
    } finally {
      locked.release();
    }
  }

  /** @param mayRetry whether the caller will repeat the request
   * @returns the response, or null if the caller should retry */
  protected async requestOnce(body: string, options: NTLMRequestOptions, mayRetry: boolean): Promise<NTLMResponse | null> {
    try {
      let authorization: string | null = null;
      let loggedInSocketID = this.authenticatedSocketID;
      if (!loggedInSocketID || !await this.conn.isAlive()) {
        let challenge = await this.negotiate();
        if (challenge.type2) {
          // The login rides on the actual request, saving a round trip
          authorization = await appGlobal.remoteApp.createType3MessageFromType2Message(
            challenge.type2, this.account.username, this.account.password);
        } // else: server does not require authentication
        loggedInSocketID = challenge.socketID;
      }
      let response = new NTLMResponse(await this.send(authorization, body, options));
      if (response.status != 401) {
        this.authenticatedSocketID = response.socketID;
        return response;
      }
      this.authenticatedSocketID = 0;
      if (authorization && response.socketID == loggedInSocketID) {
        // The server rejected the login that we just made on this very connection
        throw new LoginError(null, gt`Login failed`);
      }
      // Either the server dropped our login state, or the TCP connection was
      // replaced while our request was underway, so the server never saw our
      // login on this new connection. Either way: Log in again.
      return mayRetry ? null : response;
    } catch (ex) {
      if (mayRetry && ex?.reusedSocket && !ex.responseStarted &&
          kConnectionDropCodes.includes(ex.code)) {
        // Keep-alive race: The server closed the connection at the moment
        // our request went out on it, so it never received the request.
        // Only then may we repeat it. Once the server started to answer, it
        // processed the request, and repeating it would run it a second time,
        // e.g. send the same mail twice.
        this.authenticatedSocketID = 0;
        return null;
      }
      throw ex;
    }
  }

  /** NTLM handshake steps 1 and 2: Send Type 1, receive the server
   * challenge (Type 2). The challenge is bound to `socketID`. */
  protected async negotiate(): Promise<{ socketID: number, type2: string | null }> {
    let type1 = await appGlobal.remoteApp.createType1Message();
    // Server ignores the body of this step, so don't waste bandwidth
    // A VPN tunnel needs some time after computer woke up, can cause errors "before secure TLS connection"
    let response = await retryOnTransientError(async () => {
      // Some servers and VPN gateways drop connections when multiple are established at the same time.
      let locked = await this.handshakeLock.lock();
      let timeout = new Timeout(11, () => locked.release()); // if we hang, let the others connect
      try {
        return await this.send(type1, "", { timeoutSec: 10 * waitTime.factor }); // tests wait less
      } finally {
        timeout.fulfilled();
        locked.release();
      }
    }, 3, 8);
    if (response.status != 401) {
      return { socketID: response.socketID, type2: null };
    }
    let wwwAuthenticate = joinHeader(response.headers["www-authenticate"]);
    assert(/\bNTLM\s+[A-Za-z0-9+/=]/.test(wwwAuthenticate),
      gt`Your account is configured to use ${"NTLM"} authentication, but your server does not support it. Please change your account settings or set up the account again.`);
    return { socketID: response.socketID, type2: wwwAuthenticate };
  }

  /** Sends one HTTP request over the TCP connection, with our cookies,
   * and remembers the cookies that the server sets.
   * @returns the response, as the backend returned it over JPC */
  protected async send(authorization: string | null, body: string, options: NTLMRequestOptions = {}): Promise<any> {
    let headers: Record<string, string> = { ...options.headers };
    if (authorization) {
      headers.Authorization = authorization;
    }
    let cookie = this.cookies.header;
    if (cookie) {
      headers.Cookie = cookie;
    }
    let response = await this.conn.request({
      headers,
      body,
      timeoutSec: options.timeoutSec,
    }, options.onChunk);
    this.cookies.update(response.headers);
    return response;
  }

  /** Closes the TCP connection and aborts any request underway.
   * The connection cannot be used again afterwards. */
  close(): void {
    this.authenticatedSocketID = 0;
    this.conn?.close().catch(console.error);
  }
}

/**
 * Remembers the cookies that the server set, and sends them back.
 * Exchange and load balancers in front of it use cookies for routing
 * affinity, e.g. `X-BackEndCookie` or ISA/TMG session cookies.
 * Deliberately minimal: One server only, session lifetime only.
 */
export class CookieJar {
  protected cookies = new Map<string, string>();

  update(responseHeaders: Record<string, string | string[]>): void {
    let setCookies = responseHeaders["set-cookie"];
    if (!setCookies) {
      return;
    }
    for (let setCookie of Array.isArray(setCookies) ? setCookies : [setCookies]) {
      let cookie = setCookie.split(";")[0];
      let pos = cookie.indexOf("=");
      if (pos <= 0) {
        continue;
      }
      this.cookies.set(cookie.slice(0, pos).trim(), cookie.slice(pos + 1).trim());
    }
  }

  get header(): string {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  }
}

/** Errors where the server closed the connection without answering.
 * Deliberately narrower than `isNetworkError()`: Only these prove that the
 * server did not process the request, so only these allow a repeat. */
const kConnectionDropCodes = ["ECONNRESET", "EPIPE"];
