import { kClientHeaders } from "./clientInfo";
import { appGlobal } from "../../app";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { assert, ensureArray, UserError, type URLString } from "../../util/util";
import { gt } from "../../../l10n/l10n";

/** The only place in `Chat/Wire/` that talks HTTP.
 * It owns the 3 things that no other Wire code may duplicate: the `/vN` version
 * prefix, the `Authorization: Bearer` access token, and the `zuid` cookie.
 *
 * We read `Set-Cookie` and send `Cookie:` back ourselves, because `fetch()` has
 * no cookie jar, and we read the error response body ourselves, because Wire
 * tells its failures apart by the `label` in that body, not by the HTTP status.
 * Both need the entire response, which is what `kyCreate({ result: "response" })`
 * returns. */
export class WireTransport {
  /** e.g. `https://prod-nginz-https.wire.com` */
  baseURL: URLString;
  /** The negotiated API version, used as the `/vN` path prefix */
  version: number = null;
  accessToken: string | null = null;
  /** The `zuid` cookie value, persisted across restarts.
   * For an SSO account this is the only long-lived credential we have. */
  cookie: string | null = null;
  /** Called on 401 by the calls below; supplied by `WireSession`. */
  onTokenExpired: (() => Promise<void>) | null = null;
  /** Whether this backend federates with other Wire backends */
  federation = false;
  protected _domain: string | null = null;

  constructor(baseURL: string) {
    assert(appGlobal.remoteApp.kyCreate, "Wire: Need backend");
    this.baseURL = sanitize.url(baseURL).replace(/\/+$/, "");
  }

  /** `GET /api-version`, picks the highest version we both support.
   * Not version-prefixed. Also learns the backend's own `domain`.
   * @throws UserError, if the backend is too old or too new for us */
  async negotiateVersion(): Promise<void> {
    let json = await this.get("/api-version", { unversioned: true });
    /* `supported` and `development` are disjoint, despite what wire-server's own
     * prose docs say. To use a development version, we would have to merge both. */
    let versions = ensureArray(json.supported)
      .map(version => sanitize.integer(version, 0))
      .filter(version => version >= kMinAPIVersion && version <= kMaxAPIVersion);
    if (!versions.length) {
      throw new UserError(gt`This server speaks no chat protocol version that we understand`);
    }
    this.version = Math.max(...versions);
    this._domain = sanitize.hostname(json.domain, null);
    this.federation = sanitize.boolean(json.federation, false);
  }

  /** This backend's federation domain. Not necessarily its hostname. */
  get domain(): string {
    return this._domain;
  }

  async get(path: string, options?: WireRequestOptions): Promise<any> {
    return await this.call("get", path, null, options);
  }

  async post(path: string, json: any, options?: WireRequestOptions): Promise<any> {
    return await this.call("post", path, { json: json }, options);
  }

  async put(path: string, json: any, options?: WireRequestOptions): Promise<any> {
    return await this.call("put", path, { json: json }, options);
  }

  async delete(path: string, json?: any, options?: WireRequestOptions): Promise<any> {
    return await this.call("delete", path, { json: json }, options);
  }

  /** For `message/mls` and `application/x-protobuf` bodies */
  async postBinary(path: string, body: Uint8Array, contentType: string,
    options?: WireRequestOptions): Promise<any> {
    return await this.call("post", path, { bytes: body, contentType: contentType }, options);
  }

  async getBinary(path: string, options?: WireRequestOptions): Promise<Uint8Array> {
    return await this.call("get", path, null, options);
  }

  /** Checks whether a path exists, without fetching it, e.g. an SSO login code.
   * @throws WireError, e.g. 404 */
  async head(path: string, options?: WireRequestOptions): Promise<void> {
    await this.call("head", path, null, options);
  }

  /** @param isRetry We already refreshed the access token for this call once.
   * @throws WireError with the `label` that the backend sent */
  protected async call(method: string, path: string, body: WireBody | null,
    options: WireRequestOptions = {}, isRetry = false): Promise<any> {
    let ky = await appGlobal.remoteApp.kyCreate({
      headers: this.headers(body, options),
      timeout: kTimeoutMS,
      result: "response", // we need the response headers and the error body
      throwHttpErrors: false,
      retry: 0, // we decide ourselves what may be retried
    });
    let response = await ky[method](this.url(path, options), kyBody(body)) as THTTPResponse;
    this.readCookie(response);
    let json = this.parseBody(response);
    if (response.ok) {
      return json;
    }
    let ex = this.error(response, json);
    if (this.isTokenExpired(ex) && this.onTokenExpired && !options.noRetryOnExpiry && !isRetry) {
      await this.onTokenExpired();
      return await this.call(method, path, body, options, true);
    }
    throw ex;
  }

  protected url(path: string, options: WireRequestOptions): URLString {
    assert(path.startsWith("/"), "Wire: Need an absolute path");
    assert(options.unversioned || this.version, "Wire: Need to negotiate the API version first");
    let url = this.baseURL + (options.unversioned ? "" : `/v${this.version}`) + path;
    if (options.query) {
      let params = Object.entries(options.query).map(([name, value]) => [name, String(value)]);
      url += "?" + new URLSearchParams(params);
    }
    return url;
  }

  protected headers(body: WireBody | null, options: WireRequestOptions): Record<string, string> {
    let headers: Record<string, string> = {
      "Accept": "application/json",
      ...kClientHeaders,
    };
    /* `Z-User`, `Z-Client` and `Z-Connection` are deliberately absent: nginz
     * derives them from the token and strips whatever the client sent. */
    if (this.accessToken) {
      headers.Authorization = `Bearer ${this.accessToken}`;
    }
    if (options.withCookie && this.cookie) {
      headers.Cookie = `zuid=${this.cookie}`;
    }
    if (body?.json != null) {
      headers["Content-Type"] = "application/json";
    } else if (body?.bytes) {
      headers["Content-Type"] = body.contentType;
    }
    for (let name in options.headers) {
      headers[name] = options.headers[name];
    }
    return headers;
  }

  /** `/login` and `/access` hand out a new cookie whenever they feel like it,
   * and the new one replaces ours. */
  protected readCookie(response: THTTPResponse) {
    for (let setCookie of ensureArray(response.headers["set-cookie"] ?? [])) {
      this.cookie = parseZuidCookie(setCookie) ?? this.cookie;
    }
  }

  /** The parsed JSON body, or the raw bytes for anything else (assets), or null
   * for an empty body. Tolerant: broken JSON reads as no body, because several
   * error responses have no body or a body that is not the documented shape. */
  protected parseBody(response: THTTPResponse): any {
    if (!response.body?.length) {
      return null;
    }
    let contentType = (response.headers["content-type"] ?? "") as string;
    if (!contentType.includes("json")) {
      return response.body;
    }
    return sanitize.json(new TextDecoder().decode(response.body), null);
  }

  /** Wire's failures are told apart by the `label` of the `{code, label, message}`
   * body. Endpoints that break that contract: a throttled request has no body at
   * all, and the federation errors have no `label`. */
  protected error(response: THTTPResponse, json: any): WireError {
    let body = json instanceof Uint8Array ? null : json;
    let label = sanitize.string(body?.label, "");
    let serverMessage = sanitize.string(body?.message, "");
    let data = { ...body };
    delete data.code;
    delete data.label;
    delete data.message;
    if (response.status == kThrottledHTTPCode || response.status == 429) {
      let retryAfter = sanitize.integer(response.headers["retry-after"] as string, 0);
      return new WireRateLimitError(label || "too-many-requests", serverMessage, data, retryAfter);
    }
    return new WireError(response.status, label, serverMessage, data);
  }

  /** A 401 is always the access token. The backend also lets it expire with a
   * 403 that says so in the `message` – the `label` is the generic
   * `invalid-credentials` for every token and cookie problem alike. */
  protected isTokenExpired(ex: WireError): boolean {
    return ex.httpCode == 401 ||
      ex.httpCode == 403 && ex.serverMessage == "Zauth token expired";
  }
}

export interface WireRequestOptions {
  /** Skip the `/vN` prefix, for `/api-version` and `/access` */
  unversioned?: boolean;
  /** Send `Cookie: zuid=…`. Only `/access` and `/cookies` need it. */
  withCookie?: boolean;
  /** Do not try to refresh the token and retry on a 401 */
  noRetryOnExpiry?: boolean;
  query?: Record<string, string | number | boolean>;
  headers?: Record<string, string>;
}

/** A `{code, label, message}` error from the backend. Callers switch on `label`. */
export class WireError extends Error {
  readonly httpCode: number;
  readonly label: string;
  readonly serverMessage: string;
  /** Anything else the body carried, e.g. the missing/redundant client lists */
  readonly data: any;

  constructor(httpCode: number, label: string, serverMessage: string, data: any) {
    super(`Wire: HTTP ${httpCode}: ${serverMessage || label || "Request failed"}`);
    this.httpCode = httpCode;
    this.label = label;
    this.serverMessage = serverMessage;
    this.data = data;
  }
}

/** We are sending too fast. nginz throttles with the legacy HTTP 420, without a
 * body and without a `Retry-After`; the services behind it use 429 with both.
 * We report both as 429 – the code that wire-server itself says the 420 should
 * have been – so that `netUtil.isTransientError()` lets callers try again. */
export class WireRateLimitError extends WireError {
  /** From `Retry-After`, in seconds. 0 if the server did not say. */
  readonly retryAfterSeconds: number;

  constructor(label: string, serverMessage: string, data: any, retryAfterSeconds: number) {
    super(429, label, serverMessage, data);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** The `zuid` value of a `Set-Cookie` header, or null if it sets another cookie.
 * SSO gets the same header value handed to it in a URL parameter.
 * @param setCookie e.g. `zuid=abc==.v=1…; Path=/access; HttpOnly; Secure` */
export function parseZuidCookie(setCookie: string): string | null {
  let separator = setCookie.indexOf("=");
  if (setCookie.slice(0, separator).trim() != "zuid") {
    return null;
  }
  let value = setCookie.slice(separator + 1).split(";")[0].trim();
  // A zauth token is base64 plus `.key=value` pairs. Anything else is not ours.
  return /^[A-Za-z0-9+/=._\-]+$/.test(value) ? value : null;
}

/** What `remoteApp.kyCreate({ result: "response" })` returns */
type THTTPResponse = {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Record<string, string | string[]>;
  body: Uint8Array;
};

/** The request body: JSON, or bytes with their content type */
type WireBody = {
  json?: any;
  bytes?: Uint8Array;
  contentType?: string;
};

/** The ky options that carry the body, `{}` when there is none.
 * Not `undefined`: this crosses JPC, where an argument that is `undefined`
 * arrives as `null`, and ky accepts no options but not null ones. */
function kyBody(body: WireBody | null): any {
  if (body?.json != null) {
    return { json: body.json };
  } else if (body?.bytes) {
    return { body: body.bytes };
  }
  return {};
}

/** MLS needs API v5. Below that, we could only talk Proteus, which we do not implement. */
const kMinAPIVersion = 5;
/** The newest version whose responses we know. Higher versions are not
 * necessarily compatible, so we do not blindly take the server's newest. */
const kMaxAPIVersion = 8;
/** nginz throttles with this instead of 429, "until all clients support" 429. */
const kThrottledHTTPCode = 420;
const kTimeoutMS = 30000;
