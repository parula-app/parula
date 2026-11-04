import { sanitize } from "../../../lib/util/sanitizeDatatypes";
import { sleep, waitTime } from "./util";
import psl from "psl";

export function getDomainForEmailAddress(emailAddress: string): string {
  // Do not throw, because this function is used in {UI code}
  return sanitize.hostname(emailAddress.split("@").pop(), "unknown");
}

/**
 * Returns the base domain of hostname.
 * E.g. for "www2.static.amazon.com" returns "amazon.com"
 * and for "www2.static.amazon.co.uk" returns "amazon.co.uk"
 */
export function getBaseDomainFromHost(hostname: string): string {
  return psl.get(hostname);
}

/**
 * Returns the base domain of a URL.
 * E.g. for "https://www2.static.amazon.co.uk/foo/bar.html"
 * returns "amazon.co.uk".
 * @throws in case the URL is malformed or is a
 * @throws for relative URLs like "/foo/bar.html"
 */
export function getBaseDomainFromURL(url: string): string {
  let hostname = new URL(url).hostname;
  return getBaseDomainFromHost(hostname);
}

/** Resolves once the network is online: at once if it already is, else when
 * the browser fires `online`, e.g. after the OS wakes from sleep. */
export function waitUntilOnline(): Promise<void> {
  return navigator.onLine
    ? Promise.resolve()
    : new Promise(resolve => addEventListener("online", () => resolve(), { once: true }));
}

/** Runs `func` with a network fetch, and returns its result.
 * If it failed with a transient network or server error, tries again a few times.
 * @throws Real errors
 * @throws if failing after multiple tries. */
export async function retryOnTransientError<T>(func: () => Promise<T>, attempts = 3, delaySeconds = 3): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await func();
    } catch (ex) {
      if (!isTransientError(ex) || attempt >= attempts) {
        throw ex;
      }
      console.log(`Failed (attempt ${attempt} of ${attempts}), trying again in ${delaySeconds * attempt}s:`, ex?.message);
      await sleep(delaySeconds * attempt * waitTime.factor); // tests wait less
    }
  }
}

/** Failed to reach the server: network down, DNS, connection dropped */
export function isNetworkError(ex: any): boolean {
  // Node fetch, via backend `HTTPFetchError`
  const kNetworkErrorCodes = ["ENOTFOUND", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT",
    "EPIPE", "EAI_AGAIN", "ENETDOWN", "ENETUNREACH", "EHOSTUNREACH",
    "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET",
    // ImapFlow. `NoConnection` = socket already closed
    "ETIMEOUT", "CONNECT_TIMEOUT", "GREETING_TIMEOUT", "UPGRADE_TIMEOUT", "NoConnection"];
  // Error class `instanceof` doesn't survive JPC
  return kNetworkErrorCodes.includes(ex?.code) ||
    // Chromium `net` module, e.g. `net::ERR_CONNECTION_RESET`
    /net::ERR_(CONNECTION_|EMPTY_RESPONSE|NETWORK_CHANGED|INTERNET_DISCONNECTED|INCOMPLETE_CHUNKED_ENCODING|CONTENT_LENGTH_MISMATCH)/.test(ex?.message) ||
    // browser fetch
    ex?.name == "TypeError" &&
    /network ?error|failed to fetch|fetch failed|load failed/i.test(ex.message);
}

/** Errors that may go away by simply trying again:
 * network drop, timeout, rate limit, or server overload. */
export function isTransientError(ex: any): boolean {
  const kTransientHTTPCodes = [408, 429, 502, 503, 504];
  let httpCode = ex?.httpCode ?? ex?.status;
  return isNetworkError(ex) ||
    ex?.name == "TimeoutError" ||
    kTransientHTTPCodes.includes(httpCode);
}

/** Like `fetch()`'s `RequestInit`, plus an optional `timeout`. */
export interface FetchOptions extends RequestInit {
  /** Abort the request after this many milliseconds. */
  timeout?: number;
}

/** A non-2xx HTTP response. `httpCode` is the status, e.g. 404.
 * Read the response body on demand with `text()` or `json()` - most protocols
 * don't return a body for errors, so it isn't read unless you ask for it. */
export class HTTPError extends Error {
  readonly httpCode: number;
  readonly statusText: string;
  protected readonly response: Response;
  protected bodyText: Promise<string> | undefined;
  constructor(response: Response) {
    super(`HTTP ${response.status} ${response.statusText}`);
    this.httpCode = response.status;
    this.statusText = response.statusText;
    this.response = response;
  }

  /** The response body as text, read (once) on demand. */
  async text(): Promise<string> {
    this.bodyText ??= this.response.text();
    return await this.bodyText;
  }

  /** The response body parsed as JSON, or undefined if it isn't valid JSON. */
  async json(): Promise<any> {
    try {
      return JSON.parse(await this.text());
    } catch (ex) {
      return undefined;
    }
  }
}

/** Checks a `Response` for HTTP errors, for callers of libraries that
 * don't check it themselves, e.g. tsdav.
 * Also works for a `Response` that came over JPC, where all properties are async.
 * @throws an Error starting with `message`, if the response status is not 2xx */
export async function assertHTTPResponseOK(response: Response, message: string): Promise<void> {
  if (await response.ok) {
    return;
  }
  throw new Error(`${message}: HTTP ${await response.status} ${await response.statusText}`);
}

/** Like `fetch()`, but returns the parsed JSON body.
 * @throws HTTPError if the response status is not 2xx */
export async function fetchJSON(url: RequestInfo | URL, options?: FetchOptions): Promise<any> {
  let response = await fetchChecked(url, options);
  return await response.json();
}

/** Like `fetch()`, but returns the response body as a string.
 * @throws HTTPError if the response status is not 2xx */
export async function fetchText(url: RequestInfo | URL, options?: FetchOptions): Promise<string> {
  let response = await fetchChecked(url, options);
  return await response.text();
}

async function fetchChecked(url: RequestInfo | URL, options?: FetchOptions): Promise<Response> {
  let { timeout, ...init } = options ?? {};
  if (timeout) {
    init.signal = init.signal
      ? AbortSignal.any([init.signal, AbortSignal.timeout(timeout)])
      : AbortSignal.timeout(timeout);
  }
  let response = await fetch(url, init);
  if (!response.ok) {
    throw new HTTPError(response);
  }
  return response;
}
