// @ts-ignore Same MD4 that ntlm.js uses. node.js `crypto` dropped MD4.
import { create as createMD4 } from "../../../../../desktop/backend/node_modules/js-md4/src/md4.js";
import http from "node:http";
import type { Socket } from "node:net";
import type { AddressInfo } from "node:net";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import zlib from "node:zlib";

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

interface SocketState {
  authenticated: boolean;
  challenge: Buffer | null;
  responses: number;
}

/**
 * A mock Exchange server which strictly enforces that NTLM authenticates
 * the TCP connection: The Type 2 challenge is bound to the connection that
 * requested it, the Type 3 login is verified with real NTLMv2 crypto, and
 * a login is only ever valid for the TCP connection it happened on.
 *
 * Used to test both of our NTLM implementations, `NTLMConnectionPool`
 * (under vitest) and Chromium's (`NetSession`, run under Electron).
 */
export class NTLMTestServer {
  readonly password = "P@ssw0rd of tésts";
  readonly domain = "TESTDOM";
  protected server: http.Server;
  url: string;
  protected states = new Map<Socket, SocketState>();

  // Statistics
  socketsCreated = 0;
  requests = 0;
  handshakesCompleted = 0;
  /** Requests with a body that arrived on an unauthenticated connection */
  rejectedRequests = 0;
  /** Requests with an `Authorization` header on an already authenticated
   * connection = wasted handshakes */
  authWhileAuthenticated = 0;
  /** `Cookie` header of each request, in order */
  cookieLog: string[] = [];
  /** Body of each request that had one, in order. The Type 1 probe of the
   * handshake has none, so this is what the server actually processed. */
  requestBodies: string[] = [];
  /** TCP connections dropped by `refuseSimultaneousConnects` */
  connectsRefused = 0;
  /** Accepted, but no request on them yet, i.e. still being established */
  protected connecting = new Set<Socket>();

  // Behavior
  requireAuth = true;
  authScheme = "NTLM";
  gzipResponses = false;
  /** Close the TCP connection after this many responses on it. 0 = never */
  closeAfterResponses = 0;
  /** Destroy the TCP connection as soon as the next request arrives on it */
  killNextRequest = false;
  /** Refuse a new TCP connection that is opened while another connection is
   * still being established, like a server or VPN gateway that lets only one
   * TLS handshake through at a time */
  refuseSimultaneousConnects = false;
  /** Refuse this many TCP connections, like a VPN tunnel that is not up yet */
  refuseNextConnects = 0;
  /** Answer the next request only partially, then reset the TCP connection.
   * The server processed the request, so the client must not repeat it. */
  killWhileResponding = false;
  /** Answer only partially, then close the TCP connection gracefully (FIN),
   * like a proxy that times out a long-running response */
  endWhileResponding = false;
  /** Never answer the next request, like a silently dropped TCP connection */
  blackHoleNextRequest = false;
  /** Answer with `204 No Content`, which has no response body, by spec */
  noContent = false;
  /** Send the response in these chunks, with pauses in between */
  streamChunks: string[] | null = null;
  /** After `streamChunks`, keep the response open, like a notification stream */
  keepStreamOpen = false;
  setCookie: string | null = null;
  /** Do not answer requests whose body contains this string, until
   * `releaseHeldRequests()`. Models the long requests of a mail download. */
  holdRequestsContaining: string | null = null;
  /** `resolve()` of each request that `holdRequestsContaining` holds back */
  protected heldRequests: (() => void)[] = [];

  async start(): Promise<void> {
    this.server = http.createServer((req, res) => {
      this.onRequest(req, res).catch(ex => {
        console.error(ex);
        res.destroy();
      });
    });
    this.server.on("connection", socket => {
      if (this.refuseNextConnects > 0) {
        this.refuseNextConnects--;
        this.connectsRefused++;
        socket.resetAndDestroy();
        return;
      }
      if (this.refuseSimultaneousConnects && this.connecting.size) {
        this.connectsRefused++;
        socket.resetAndDestroy();
        return;
      }
      this.socketsCreated++;
      this.connecting.add(socket);
      this.states.set(socket, { authenticated: false, challenge: null, responses: 0 });
      socket.on("data", () => {
        if (this.killNextRequest) {
          this.killNextRequest = false;
          socket.destroy();
        }
      });
      socket.on("close", () => {
        this.connecting.delete(socket);
        this.states.delete(socket);
      });
    });
    await new Promise<void>(resolve => this.server.listen(0, "127.0.0.1", resolve));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}/EWS/Exchange.asmx`;
  }

  async stop(): Promise<void> {
    for (let socket of this.states.keys()) {
      socket.destroy();
    }
    await new Promise<void>(resolve => this.server.close(() => resolve()));
  }

  /** How many requests `holdRequestsContaining` is currently holding back,
   * i.e. how many of them reached the server at all */
  get heldRequestCount(): number {
    return this.heldRequests.length;
  }

  /** Lets the requests that `holdRequestsContaining` held run to completion */
  releaseHeldRequests(): void {
    let held = this.heldRequests;
    this.heldRequests = [];
    for (let release of held) {
      release();
    }
  }

  /** Simulates a load balancer moving us to a backend server that has not
   * seen our login: All connections lose their authentication. */
  dropAuthState(): void {
    for (let state of this.states.values()) {
      state.authenticated = false;
      state.challenge = null;
    }
  }

  protected async onRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    this.requests++;
    this.connecting.delete(req.socket); // the connection is up

    this.cookieLog.push(req.headers.cookie ?? "");
    let body = "";
    for await (let chunk of req) {
      body += chunk;
    }
    if (body) {
      this.requestBodies.push(body);
    }
    let state = this.states.get(req.socket);
    if (!state) {
      res.destroy();
      return;
    }
    if (this.blackHoleNextRequest) {
      this.blackHoleNextRequest = false;
      return;
    }
    if (!this.requireAuth || state.authenticated) {
      if (req.headers.authorization) {
        this.authWhileAuthenticated++;
      }
      await this.respondOK(res, state, body);
      return;
    }
    let auth = req.headers.authorization;
    if (this.authScheme == "NTLM" && auth?.startsWith("NTLM ")) {
      let msg = Buffer.from(auth.slice(5), "base64");
      let type = msg.length > 12 ? msg.readUInt32LE(8) : 0;
      if (type == 1) {
        state.challenge = randomBytes(8);
        this.respond401(res, state, this.buildType2(state.challenge));
        return;
      }
      if (type == 3 && state.challenge &&
          verifyType3NTLMv2(msg, state.challenge, this.password)) {
        // The challenge is bound to this TCP connection, and used once
        state.challenge = null;
        state.authenticated = true;
        this.handshakesCompleted++;
        await this.respondOK(res, state, body);
        return;
      }
      // Type 3 for a challenge of another connection, or wrong password
      state.challenge = null;
      this.respond401(res, state, this.authScheme);
      return;
    }
    if (body) {
      this.rejectedRequests++;
    }
    this.respond401(res, state, this.authScheme);
  }

  protected async respondOK(res: http.ServerResponse, state: SocketState, requestBody: string): Promise<void> {
    if (this.holdRequestsContaining && requestBody.includes(this.holdRequestsContaining)) {
      await new Promise<void>(resolve => this.heldRequests.push(resolve));
    }
    if (this.noContent) {
      res.writeHead(204);
      this.finishResponse(res, state);
      res.end();
      return;
    }
    if (this.streamChunks) {
      res.writeHead(200, { "Content-Type": "text/xml" });
      this.streamResponse(res).catch(console.error);
      return;
    }
    let body: Buffer | string = `<response>${requestBody}</response>`;
    let headers: Record<string, string> = { "Content-Type": "text/xml" };
    if (this.gzipResponses) {
      body = zlib.gzipSync(Buffer.from(body));
      headers["Content-Encoding"] = "gzip";
    }
    res.writeHead(200, headers);
    if (this.killWhileResponding || this.endWhileResponding) {
      res.write(body.slice(0, 5));
      this.killConnection(res).catch(console.error);
      return;
    }
    this.finishResponse(res, state);
    res.end(body);
  }

  protected async streamResponse(res: http.ServerResponse): Promise<void> {
    for (let chunk of this.streamChunks) {
      res.write(chunk);
      if (this.killWhileResponding || this.endWhileResponding) {
        await this.killConnection(res);
        return;
      }
      await sleep(30);
    }
    if (!this.keepStreamOpen) {
      res.end();
    }
  }

  /** Ends the connection in the middle of the response, after giving the
   * client time to receive what we already sent of it */
  protected async killConnection(res: http.ServerResponse): Promise<void> {
    let socket = res.socket;
    await sleep(30);
    if (this.endWhileResponding) {
      socket?.end(); // FIN
    } else {
      socket?.resetAndDestroy(); // RST, not FIN
    }
  }

  protected respond401(res: http.ServerResponse, state: SocketState, wwwAuthenticate: string): void {
    let headers: Record<string, string> = {
      "WWW-Authenticate": wwwAuthenticate,
      "Content-Type": "text/html",
    };
    if (this.setCookie) {
      headers["Set-Cookie"] = this.setCookie + "; path=/; HttpOnly";
    }
    res.writeHead(401, headers);
    this.finishResponse(res, state);
    res.end("<html>401 Unauthorized</html>");
  }

  /** Call before `res.end()`, while `res.socket` is still attached */
  protected finishResponse(res: http.ServerResponse, state: SocketState): void {
    state.responses++;
    if (this.closeAfterResponses && state.responses >= this.closeAfterResponses) {
      let socket = res.socket;
      res.on("finish", () => socket?.end()); // FIN after the response bytes are out
    }
  }

  /** NTLM Type 2 message with the given server challenge,
   * negotiating unicode, extended security and target info,
   * so that the client answers with NTLMv2. */
  protected buildType2(challenge: Buffer): string {
    let targetName = Buffer.from(this.domain, "utf16le");
    let targetInfo = Buffer.concat([
      avPair(2, Buffer.from(this.domain, "utf16le")), // MsvAvNbDomainName
      avPair(1, Buffer.from("TESTSRV", "utf16le")), // MsvAvNbComputerName
      avPair(0, Buffer.alloc(0)), // MsvAvEOL
    ]);
    const kHeaderLength = 48;
    let buf = Buffer.alloc(kHeaderLength + targetName.length + targetInfo.length);
    buf.write("NTLMSSP\0", 0, 8, "ascii");
    buf.writeUInt32LE(2, 8); // Type 2
    buf.writeUInt16LE(targetName.length, 12);
    buf.writeUInt16LE(targetName.length, 14);
    buf.writeUInt32LE(kHeaderLength, 16);
    const kFlags = 0x1 | // NegotiateUnicode
      0x4 | // RequestTarget
      0x200 | // NegotiateNTLM
      0x8000 | // NegotiateAlwaysSign
      0x10000 | // TargetTypeDomain
      0x80000 | // NegotiateExtendedSecurity
      0x800000; // NegotiateTargetInfo
    buf.writeUInt32LE(kFlags, 20);
    challenge.copy(buf, 24);
    // 32-39: reserved, zero
    buf.writeUInt16LE(targetInfo.length, 40);
    buf.writeUInt16LE(targetInfo.length, 42);
    buf.writeUInt32LE(kHeaderLength + targetName.length, 44);
    targetName.copy(buf, kHeaderLength);
    targetInfo.copy(buf, kHeaderLength + targetName.length);
    return "NTLM " + buf.toString("base64");
  }
}

function avPair(id: number, value: Buffer): Buffer {
  let header = Buffer.alloc(4);
  header.writeUInt16LE(id, 0);
  header.writeUInt16LE(value.length, 2);
  return Buffer.concat([header, value]);
}

/**
 * Verifies the client's NTLMv2 proof against the server challenge and the
 * known password, like a real server. @see MS-NLMP section 3.3.2
 */
function verifyType3NTLMv2(msg: Buffer, serverChallenge: Buffer, password: string): boolean {
  if (msg.slice(0, 8).toString("ascii") != "NTLMSSP\0" || msg.readUInt32LE(8) != 3) {
    return false;
  }
  let ntLen = msg.readUInt16LE(20);
  let ntOffset = msg.readUInt32LE(24);
  let domainLen = msg.readUInt16LE(28);
  let domainOffset = msg.readUInt32LE(32);
  let userLen = msg.readUInt16LE(36);
  let userOffset = msg.readUInt32LE(40);
  let flags = msg.readUInt32LE(60);
  let encoding: BufferEncoding = flags & 0x1 ? "utf16le" : "ascii";
  let username = msg.slice(userOffset, userOffset + userLen).toString(encoding);
  let domain = msg.slice(domainOffset, domainOffset + domainLen).toString(encoding);
  let ntResponse = msg.slice(ntOffset, ntOffset + ntLen);
  if (ntResponse.length < 48) {
    return false; // Not NTLMv2
  }
  let proof = ntResponse.slice(0, 16);
  let blob = ntResponse.slice(16);
  // NTOWFv2 = HMAC-MD5(MD4(UTF16LE(password)), UTF16LE(UPPER(user) + domain))
  let pwdHash = Buffer.from(createMD4().update(Buffer.from(password, "utf16le")).digest());
  let ntowfV2 = hmacMD5(pwdHash, Buffer.from(username.toUpperCase() + domain, "utf16le"));
  let expectedProof = hmacMD5(ntowfV2, Buffer.concat([serverChallenge, blob]));
  return timingSafeEqual(proof, expectedProof);
}

function hmacMD5(key: Buffer, data: Buffer): Buffer {
  return createHmac("md5", key).update(data).digest();
}
