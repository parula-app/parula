import type { ConnectionPurpose } from "../../Mail/EWS/ConnectionPurpose";

export interface NTLMRequestOptions {
  headers?: Record<string, string>;
  onChunk?: (chunk: string) => Promise<void>;
  purpose?: ConnectionPurpose;
  /** Give up if server does not answer. Default in backend: 30s */
  timeoutSec?: number;
}

/** A `fetch()` `Response`, plus the TCP connection that it came in on */
export class NTLMResponse extends Response {
  /** Which TCP connection served this response. Only our own NTLM
   * implementation knows it, and only it needs it. @see `HTTPConnection` */
  readonly socketID: number;

  /** @param response as the backend returned it over JPC */
  constructor(response: any) {
    let headers = new Headers();
    for (let name in response.headers) {
      headers.set(name, joinHeader(response.headers[name]));
    }
    // An empty body must be `null`: `Response` forbids a body for 204 etc.
    super(response.body || null, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
    this.socketID = response.socketID;
  }
}

/** node gives repeated HTTP headers as an array */
export function joinHeader(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value.join(", ") : value ?? "";
}
