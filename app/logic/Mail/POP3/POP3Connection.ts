import type { POP3Account } from "./POP3Account";
import { AuthMethod, ConnectError, LoginError } from "../../Abstract/Account";
import { TLSSocketType } from "../../Abstract/TCPAccount";
import { appGlobal } from "../../app";
import { Lock } from "../../util/flow/Lock";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { assert } from "../../util/util";
import { gt } from "../../../l10n/l10n";
import { ArrayColl, MapColl } from "svelte-collections";
import { hmac } from "@noble/hashes/hmac.js";
import { md5 } from "@noble/hashes/legacy.js";
import { bytesToHex } from "@noble/hashes/utils.js";

/** RFC 1939 POP3, RFC 2449 CAPA, RFC 2595 STLS, RFC 5034 AUTH */
export class POP3Connection {
  readonly account: POP3Account;
  /** Capability → arguments, both uppercase */
  readonly capabilities = new MapColl<string, string>();
  isLoggedIn = false;
  closed = false;
  protected apopTimestamp: string | null = null;
  /** `net.Socket` or `tls.TLSSocket` in the backend, reached over JPC */
  protected socket: any = null;
  /** Bytes received, but not yet parsed. `receivedLength` of them are valid. */
  protected received = new Uint8Array(16 * 1024);
  protected receivedLength = 0;
  protected readonly pending = new ArrayColl<PendingResponse>();
  protected readonly commandLock = new Lock();

  constructor(account: POP3Account) {
    this.account = account;
  }

  async login(): Promise<void> {
    try {
      await this.connect();
      await this.readGreeting();
      await this.readCapabilities();
      if (this.account.tls == TLSSocketType.STARTTLS) {
        await this.command("STLS");
        await this.startTLS();
        await this.readCapabilities(); // they differ after STLS (RFC 2595)
      }
      await this.authenticate();
      await this.readCapabilities(); // e.g. Gmail shows PIPELINING only now
      if (this.capabilities.has("UTF8")) {
        await this.command("UTF8"); // RFC 6856. Courier otherwise replaces a mail with non-ASCII headers with a MIME wrapper
      }
      this.isLoggedIn = true;
    } catch (ex) {
      await this.close();
      throw ex;
    }
  }

  protected async connect(): Promise<void> {
    let acc = this.account;
    let socket = await appGlobal.remoteApp.newTCPSocket();
    await this.listen(socket);
    const kConnectTimeoutSeconds = 10;
    await socket.setTimeout(kConnectTimeoutSeconds * 1000);
    await new Promise<void>((resolve, reject) => {
      socket.on("connect", resolve);
      socket.on("error", (ex: any) => reject(new ConnectError(ex,
        gt`Failed to connect to server ${acc.hostname} for account ${acc.name}` + "\n" + (ex?.message ?? ""))));
      socket.connect(acc.port, acc.hostname);
    });
    await socket.setTimeout(0);
    this.socket = socket;
    if (acc.tls == TLSSocketType.TLS) {
      await this.startTLS();
    }
    const kCommandTimeoutSeconds = 5 * 60; // STAT on a huge mailbox may take minutes
    await this.socket.setTimeout(kCommandTimeoutSeconds * 1000);
  }

  /** Attach the listeners before `connect()`, otherwise early events are lost */
  protected async listen(socket: any): Promise<void> {
    await socket.on("data", (data: Uint8Array) => this.onData(data));
    await socket.on("error", (ex: any) => this.close(ex));
    await socket.on("close", () => this.close());
    await socket.on("timeout", () => this.close(new ConnectError(null, gt`Server ${this.account.hostname} did not respond`)));
  }

  protected async startTLS(): Promise<void> {
    let acc = this.account;
    await this.socket.setTimeout(0);
    try {
      let tlsOptions: any = { rejectUnauthorized: !acc.acceptBrokenTLSCerts };
      if (acc.acceptOldTLS) {
        tlsOptions.minVersion = "TLSv1";
      }
      this.socket = await appGlobal.remoteApp.startTLS(this.socket, acc.hostname, tlsOptions);
    } catch (ex) {
      throw new ConnectError(ex, gt`TLS connection to server ${acc.hostname} failed` + "\n" + (ex?.message ?? ""));
    }
    await this.listen(this.socket);
  }

  protected async readGreeting(): Promise<void> {
    let greeting: POP3Response;
    try {
      greeting = await this.readResponse(false);
    } catch (ex) {
      throw new ConnectError(ex, gt`Server ${this.account.hostname} refused the connection` + "\n" + ex.message);
    }
    this.apopTimestamp = greeting.text.match(/<[^<>@\s]+@[^<>\s]+>/)?.[0] ?? null;
  }

  protected async readCapabilities(): Promise<void> {
    this.capabilities.clear();
    let response: POP3Response;
    try {
      response = await this.command("CAPA", true);
    } catch (ex) {
      if (ex instanceof POP3Error) {
        return;
      }
      throw ex;
    }
    for (let line of decode(response.body).split("\n")) {
      let [tag, ...args] = line.trim().toUpperCase().split(/\s+/);
      if (tag) {
        this.capabilities.set(tag, args.join(" "));
      }
    }
  }

  get pipelining(): boolean {
    return this.capabilities.has("PIPELINING");
  }

  protected async authenticate(): Promise<void> {
    let acc = this.account;
    let mechanisms = (this.capabilities.get("SASL") ?? "").split(" ");
    for (let tag of ["XOAUTH2", "OAUTHBEARER"]) {
      if (this.capabilities.has(tag)) { // QQ lists it outside SASL
        mechanisms.push(tag);
      }
    }
    try {
      if (acc.authMethod == AuthMethod.OAuth2) {
        let token = acc.oAuth2?.accessToken;
        assert(token, acc.name + `: ` + gt`OAuth2: Login failed`);
        if (mechanisms.includes("OAUTHBEARER") && !mechanisms.includes("XOAUTH2")) {
          await this.authSASL("OAUTHBEARER", () => `n,a=${acc.username},\x01host=${acc.hostname}\x01port=${acc.port}\x01auth=Bearer ${token}\x01\x01`, "\x01");
        } else {
          await this.authSASL("XOAUTH2", () => `user=${acc.username}\x01auth=Bearer ${token}\x01\x01`);
        }
      } else if (acc.authMethod == AuthMethod.CRAMMD5) {
        if (mechanisms.includes("CRAM-MD5")) {
          await this.authSASL("CRAM-MD5", challenge =>
            `${acc.username} ${bytesToHex(hmac(md5, utf8(acc.password), utf8(challenge)))}`);
        } else if (this.apopTimestamp) {
          await this.command(`APOP ${acc.username} ${bytesToHex(md5(utf8(this.apopTimestamp + acc.password)))}`);
        } else {
          throw new LoginError(null, gt`Server ${acc.hostname} does not support CRAM-MD5 or APOP`);
        }
      } else if (mechanisms.includes("PLAIN") && !this.capabilities.has("USER")) {
        await this.authSASL("PLAIN", () => `\0${acc.username}\0${acc.password}`);
      } else {
        await this.command(`USER ${acc.username}`);
        await this.command(`PASS ${acc.password}`);
      }
    } catch (ex) {
      throw this.loginError(ex);
    }
  }

  /** No initial response: With an OAuth2 token, the command would exceed the 255 octet limit.
   * @param cancel OAuth2 servers answer a bad token with another challenge, and expect this before the `-ERR` */
  protected async authSASL(mechanism: string, respond: (challenge: string) => string, cancel = ""): Promise<void> {
    let response = await this.command(`AUTH ${mechanism}`);
    assert(response.status == "+", gt`Server ${this.account.hostname} refused the ${mechanism} login`);
    response = await this.command(base64(respond(decode(base64ToBytes(response.text)))));
    if (response.status == "+") {
      await this.command(cancel);
    }
  }

  protected loginError(ex: any): Error {
    if (!(ex instanceof POP3Error)) {
      return ex;
    }
    if (["IN-USE", "LOGIN-DELAY", "SYS/TEMP"].includes(ex.code) || /lock|wait|busy|too many/i.test(ex.message)) {
      return new ConnectError(ex, gt`Server ${this.account.hostname} is busy` + "\n" + ex.message);
    }
    if (/basic authentication is disabled/i.test(ex.message)) {
      return new LoginError(ex, gt`Server ${this.account.hostname} requires OAuth2 login. Please change the authentication method.`);
    }
    if (/under a layer|plaintext/i.test(ex.message)) {
      return new LoginError(ex, gt`Server ${this.account.hostname} requires an encrypted connection for the login. Please turn on TLS.` + "\n" + ex.message);
    }
    return new LoginError(ex, gt`Check your login, username, and password.` + "\n" + ex.message);
  }

  async stat(): Promise<{ count: number, size: number }> {
    let [count, size] = (await this.command("STAT")).text.split(" ");
    return { count: sanitize.integer(count), size: sanitize.integer(size, 0) };
  }

  async uidlAll(): Promise<MapColl<number, string>> {
    let listing = new MapColl<number, string>();
    for (let line of decode((await this.command("UIDL", true)).body).split("\n")) {
      line = line.trim();
      if (!line) {
        continue;
      }
      let space = line.indexOf(" ");
      listing.set(sanitize.integer(line.slice(0, space)), line.slice(space + 1).trim());
    }
    return listing;
  }

  async uidl(number: number): Promise<string> {
    let text = (await this.command(`UIDL ${number}`)).text;
    let space = text.indexOf(" ");
    assert(sanitize.integer(text.slice(0, space)) == number, "POP3: UIDL for wrong message");
    return text.slice(space + 1).trim();
  }

  async retr(number: number): Promise<Uint8Array> {
    return (await this.command(`RETR ${number}`, true)).body;
  }

  async dele(number: number): Promise<void> {
    await this.command(`DELE ${number}`);
  }

  /** The response is advisory: Some servers answer it before they finished
   * deleting, and others close the connection instead of answering. */
  async quit(): Promise<void> {
    try {
      if (!this.closed) {
        await this.command("QUIT");
      }
    } catch (ex) {
      // the mails are downloaded already
    } finally {
      await this.close();
    }
  }

  /** @param multiline Whether a `+OK` response continues with lines until a "." line */
  async command(line: string, multiline = false): Promise<POP3Response> {
    if (this.closed) {
      throw new ConnectError(null, gt`Connection to server ${this.account.hostname} is closed`);
    }
    let lock = await this.commandLock.lock();
    let response = this.readResponse(multiline);
    try {
      this.log(">", line);
      await this.socket.write(utf8(line + "\r\n"));
      if (!this.pipelining) {
        return await response;
      }
    } finally {
      lock.release();
    }
    return await response;
  }

  protected readResponse(multiline: boolean): Promise<POP3Response> {
    let promise = new Promise<POP3Response>((resolve, reject) => {
      this.pending.add({ multiline, resolve, reject, scanned: 0 });
    });
    this.parsePending(); // the response may have arrived already, e.g. the greeting
    return promise;
  }

  protected onData(chunk: Uint8Array) {
    if (this.receivedLength + chunk.length > this.received.length) {
      let bigger = new Uint8Array(Math.max(this.received.length * 2, this.receivedLength + chunk.length));
      bigger.set(this.received.subarray(0, this.receivedLength));
      this.received = bigger;
    }
    this.received.set(chunk, this.receivedLength);
    this.receivedLength += chunk.length;
    this.parsePending();
  }

  protected parsePending() {
    try {
      while (this.pending.hasItems) {
        let pending = this.pending.first;
        let response = this.parseResponse(pending);
        if (!response) {
          return;
        }
        this.pending.remove(pending);
        if (response.status == "-ERR") {
          pending.reject(new POP3Error(response));
        } else {
          pending.resolve(response);
        }
      }
    } catch (ex) {
      this.close(ex);
    }
  }

  /** @returns null, if the response did not arrive completely yet */
  protected parseResponse(pending: PendingResponse): POP3Response | null {
    let lineEnd = this.received.subarray(0, this.receivedLength).indexOf(kLF);
    if (lineEnd < 0) {
      return null;
    }
    let line = decode(this.received.subarray(0, lineEnd)).replace(/\r$/, "");
    let match = line.match(/^(\+OK|-ERR|\+)\s?(.*)$/i);
    assert(match, `POP3: Unexpected response from server: ${line}`);
    let status = match[1].toUpperCase() as POP3Response["status"];
    let text = match[2];
    let end = lineEnd + 1;
    let body: Uint8Array | null = null;
    if (status == "+OK" && pending.multiline) {
      let terminator = this.findTerminator(Math.max(lineEnd, pending.scanned), pending);
      if (!terminator) {
        return null;
      }
      body = unstuff(this.received.subarray(end, terminator.dot));
      end = terminator.end;
    }
    this.log("<", line);
    this.received.copyWithin(0, end, this.receivedLength);
    this.receivedLength -= end;
    let code = text.match(/^\[([^\]]+)\]\s*/);
    return {
      status,
      code: code ? code[1].toUpperCase() : null,
      text: code ? text.slice(code[0].length) : text,
      body,
    };
  }

  /** @returns Position of the "." line that ends a multi-line response, and of the byte after it. null = not received yet */
  protected findTerminator(from: number, pending: PendingResponse): { dot: number, end: number } | null {
    let buf = this.received;
    let len = this.receivedLength;
    for (let i = from; i + 2 < len; i++) {
      if (buf[i] != kLF || buf[i + 1] != kDot) {
        continue;
      }
      if (buf[i + 2] == kLF) {
        return { dot: i + 1, end: i + 3 };
      }
      if (buf[i + 2] == kCR && i + 3 < len && buf[i + 3] == kLF) {
        return { dot: i + 1, end: i + 4 };
      }
    }
    pending.scanned = Math.max(from, len - 4);
    return null;
  }

  async close(ex?: any): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.isLoggedIn = false;
    let error = ex instanceof ConnectError ? ex :
      new ConnectError(ex, gt`Connection to server ${this.account.hostname} closed` + (ex?.message ? "\n" + ex.message : ""));
    for (let pending of this.pending.contents) {
      pending.reject(error);
    }
    this.pending.clear();
    this.received = new Uint8Array(0);
    try {
      await this.socket?.destroy();
    } catch (ex) {
      // already dead
    }
  }

  protected log(direction: "<" | ">", line: string) {
    if (!this.account.logCommands) {
      return;
    }
    if (/^(PASS|APOP) /i.test(line) || /^[A-Za-z0-9+/=]{16,}$/.test(line)) { // password or SASL response
      line = line.split(" ")[0].replace(/^[A-Za-z0-9+/=]{16,}$/, "") + " ***";
    }
    console.log("POP3", this.account.name, direction, line);
  }
}

export type POP3Response = {
  /** `+` = SASL challenge (RFC 5034) */
  status: "+OK" | "-ERR" | "+",
  /** RFC 2449 response code, uppercase, e.g. "AUTH", "IN-USE", "SYS/TEMP" */
  code: string | null,
  text: string,
  body: Uint8Array | null,
};

/** The server said `-ERR` */
export class POP3Error extends Error {
  code: string | null;
  constructor(response: POP3Response) {
    super(response.text || "Server error");
    this.code = response.code;
  }
}

type PendingResponse = {
  multiline: boolean,
  resolve: (response: POP3Response) => void,
  reject: (ex: Error) => void,
  /** Position in `received` up to which we already searched for the end of the body */
  scanned: number,
};

const kLF = 0x0A;
const kCR = 0x0D;
const kDot = 0x2E;

function unstuff(body: Uint8Array): Uint8Array {
  let out = new Uint8Array(body.length);
  let o = 0;
  let lineStart = true;
  for (let b of body) {
    if (lineStart && b == kDot) {
      lineStart = false;
      continue;
    }
    out[o++] = b;
    lineStart = b == kLF;
  }
  return o == out.length ? out : out.slice(0, o);
}

function utf8(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

function decode(bytes: Uint8Array | null): string {
  return new TextDecoder().decode(bytes ?? new Uint8Array(0));
}

function base64(str: string): string {
  return btoa(String.fromCharCode(...utf8(str)));
}

function base64ToBytes(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64.trim()), c => c.charCodeAt(0));
}
