import { readBodyText } from "./httpBody";
import http from "node:http";
import https from "node:https";
import tls from "node:tls";
import zlib from "node:zlib";

/**
 * A HTTP(S) client that runs all requests over a single TCP connection.
 *
 * Connection-based HTTP authentication (NTLM, Negotiate) authenticates the
 * TCP connection, not the HTTP request. `fetch()` hides which connection of
 * its pool a request goes out on, which makes such authentication unreliable.
 * This class guarantees at most one TCP connection at any time, and each
 * response reports which connection served it (`socketID`), so the caller
 * always knows whether the connection is still the one it authenticated.
 *
 * This is only the transport. The authentication handshake logic is driven
 * by the caller in app/logic (see `NTLMConnection`), based on `socketID`.
 *
 * The caller should send one request at a time. Concurrency comes from
 * using multiple `HTTPConnection` objects (see `NTLMConnectionPool`).
 *
 * Limitations: Connects directly, ignoring OS proxy settings, and does
 * not follow redirects. NTLM cannot pass through a proxy or redirect
 * anyway, because both break the end-to-end TCP connection.
 */
export class HTTPConnection {
  protected url: URL;
  protected agent: http.Agent;
  protected protocolModule: typeof http | typeof https;
  /** Identifies the TCP connection of each socket ever used, starting at 1 */
  protected socketIDs = new WeakMap<object, number>();
  protected lastSocketID = 0;
  /** In-flight requests, so that `close()` can abort them */
  protected requests = new Set<http.ClientRequest>();
  protected _closed = false;

  constructor(url: string, options?: HTTPConnectionOptions) {
    this.url = new URL(url);
    let secure = this.url.protocol == "https:";
    this.protocolModule = secure ? https : http;
    let agentOptions: https.AgentOptions = {
      keepAlive: true,
      maxSockets: 1, // the whole point of this class
      /** Idle authenticated connections occupy a slot on our end and on the server.
          Close before VPN terminates the connection after 5 mins. */
      timeout: 3 * k1MinuteMS,
    };
    if (secure) {
      agentOptions.ca = getCACertificates();
      if (options?.acceptBrokenTLSCerts) {
        agentOptions.rejectUnauthorized = false;
      }
    }
    this.agent = new this.protocolModule.Agent(agentOptions);
  }

  /**
   * @param options.timeoutSec Give up if the server does not answer. Default 30s.
   * @param onChunk If given, a 2xx response body is streamed: `onChunk` is
   *   awaited for each chunk, `body` stays empty, and the returned promise
   *   resolves only once the stream ended. Non-2xx responses are returned
   *   whole, so that the caller can handle auth challenges before streaming.
   * @throws Network errors carry `reusedSocket` and `responseStarted`, so that
   *   the caller can tell whether the server already processed the request.
   */
  async request(options: {
    method?: string,
    headers?: Record<string, string>,
    body?: string,
    timeoutSec?: number,
  }, onChunk?: (chunk: string) => Promise<void>): Promise<HTTPConnectionResponse> {
    if (this._closed) {
      throw newErrorWithCode("HTTP connection is closed", "ECONNCLOSED");
    }
    let body = options.body ?? "";
    let headers: Record<string, string> = {
      "Content-Length": Buffer.byteLength(body) + "",
      // Advertise gzip only where we buffer the whole body. Decompressing
      // a stream could delay chunks in the zlib buffer.
      "Accept-Encoding": onChunk ? "identity" : "gzip",
      ...options.headers,
    };
    let timeoutSec = options.timeoutSec ?? 30;
    let req = this.protocolModule.request(this.url, {
      method: options.method ?? "POST",
      headers,
      agent: this.agent,
      timeout: onChunk // onChunk = streaming
        ? 0 // no timeout
        : timeoutSec * 1000,
    });
    this.requests.add(req);
    try {
      return await new Promise((resolve, reject) => {
        let socketID = 0;
        let reusedSocket = false;
        let responseStarted = false;
        // Own properties, so they survive the JPC serialization, like `code`
        let fail = (ex: any) => {
          ex.reusedSocket = reusedSocket;
          ex.responseStarted = responseStarted;
          reject(ex);
        };
        req.on("socket", socket => {
          let id = this.socketIDs.get(socket);
          if (!id) {
            id = ++this.lastSocketID;
            this.socketIDs.set(socket, id);
          }
          socketID = id;
          reusedSocket = req.reusedSocket;
        });
        req.on("error", fail);
        // No retry, because server may have processed the request
        req.on("timeout", () => req.destroy(newErrorWithCode(
          `Server did not answer within ${timeoutSec} seconds`, "ETIMEDOUT")));
        req.on("response", res => {
          responseStarted = true;
          this.readResponse(res, socketID, reusedSocket, onChunk)
            .then(resolve, fail);
        });
        req.end(body);
      });
    } finally {
      this.requests.delete(req);
    }
  }

  protected async readResponse(res: http.IncomingMessage,
      socketID: number, reusedSocket: boolean,
      onChunk?: (chunk: string) => Promise<void>): Promise<HTTPConnectionResponse> {
    let response: HTTPConnectionResponse = {
      status: res.statusCode ?? 0,
      statusText: res.statusMessage ?? "",
      ok: !!res.statusCode && res.statusCode >= 200 && res.statusCode <= 299,
      headers: res.headers as Record<string, string | string[]>,
      body: "",
      socketID,
      reusedSocket,
    };
    let stream: NodeJS.ReadableStream = res;
    let encoding = res.headers["content-encoding"];
    if (encoding == "gzip" || encoding == "deflate") {
      let unzip = zlib.createUnzip();
      res.on("error", ex => unzip.destroy(ex));
      stream = res.pipe(unzip);
    }
    response.body = await readBodyText(stream, response.ok ? onChunk : undefined);
    return response;
  }

  /**
   * Whether the authenticated TCP connection is (still) open.
   * Between two requests, the server may have closed it, or we dropped it
   * because it sat unused. If so, the caller knows to re-authenticate
   * without wasting a request that would fail.
   * The socket can still die right after this check, but the caller detects
   * that from `socketID` of the next response.
   */
  isAlive(): boolean {
    for (let list of [this.agent.freeSockets, this.agent.sockets]) {
      for (let name in list) {
        if (list[name]?.some(socket => !socket.destroyed)) {
          return true;
        }
      }
    }
    return false;
  }

  /** Closes the TCP connection and aborts any in-flight request. */
  close(): void {
    this._closed = true;
    for (let req of this.requests) {
      req.destroy(newErrorWithCode("HTTP connection was closed", "ECONNCLOSED"));
    }
    this.requests.clear();
    this.agent.destroy();
  }
}

export interface HTTPConnectionOptions {
  acceptBrokenTLSCerts?: boolean;
}

export interface HTTPConnectionResponse {
  status: number;
  statusText: string;
  ok: boolean;
  /** Lowercase header names. `set-cookie` is a string array. */
  headers: Record<string, string | string[]>;
  body: string;
  /** Which TCP connection of this `HTTPConnection` served this request.
   * Changes whenever the connection had to be re-established. */
  socketID: number;
  /** Whether the request went out on a kept-alive connection.
   * If such a request fails before any response byte arrived (`responseStarted`
   * on the error), the server closed the connection while the request was on
   * the wire, and it is safe to retry. */
  reusedSocket: boolean;
}

function newErrorWithCode(message: string, code: string): Error {
  let ex = new Error(message);
  (ex as any).code = code;
  return ex;
}

let caCertificates: string[] | null = null;
/** The renderer's `fetch()` trusts the OS certificate store, node only its
 * bundled CAs. Corporate Exchange servers often use a company CA, so add the
 * system CAs. */
function getCACertificates(): string[] {
  if (!caCertificates) {
    caCertificates = [...tls.rootCertificates];
    if (tls.getCACertificates) { // node >= 22.15
      try {
        caCertificates = [...new Set([
          ...tls.getCACertificates("default"), // bundled + NODE_EXTRA_CA_CERTS
          ...tls.getCACertificates("system"),
        ])];
      } catch (ex) {
        console.error(ex);
      }
    }
  }
  return caCertificates;
}

const k1MinuteMS = 60 * 1000;