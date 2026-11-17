import net from "node:net";
import tls from "node:tls";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

export type FakeMail = { uidl: string, mime: string };

/** A minimal POP3 server on localhost, for tests.
 * RFC 1939, CAPA RFC 2449, STLS RFC 2595, AUTH RFC 5034 */
export class FakePOP3Server {
  mails: FakeMail[] = [];
  /** Every command line received, in order, all sessions */
  commands: string[] = [];
  username = "user";
  password = "secret";
  /** OAuth2 access token that we accept */
  token = "valid-token";
  /** "implicit" = TLS from the start, "starttls" = STLS on a plain connection, null = plain only */
  tlsMode: "implicit" | "starttls" | null = null;
  capabilities = ["TOP", "UIDL", "USER", "PIPELINING", "SASL PLAIN XOAUTH2"];
  /** Send responses in pieces of this many bytes, with a pause in between,
   * so that the client has to reassemble them. 0 = whole */
  chunkSize = 0;
  greeting = "+OK Fake POP3 server ready";
  port: number;
  protected server: net.Server;

  async start(): Promise<void> {
    let onConnection = (socket: net.Socket) => this.session(socket).catch(ex => {
      if (ex.code != "ECONNRESET") {
        console.error("Fake POP3 server session failed", ex);
      }
      socket.destroy();
    });
    this.server = this.tlsMode == "implicit"
      ? tls.createServer({ cert: kCert, key: kKey }, onConnection)
      : net.createServer(onConnection);
    await new Promise<void>(resolve => this.server.listen(0, "127.0.0.1", resolve));
    this.port = (this.server.address() as net.AddressInfo).port;
  }

  async stop(): Promise<void> {
    await new Promise(resolve => this.server.close(resolve));
  }

  protected async session(socket: net.Socket): Promise<void> {
    let reader = new LineReader(socket);
    let send = async (text: string) => {
      if (!this.chunkSize) {
        socket.write(text);
        return;
      }
      for (let i = 0; i < text.length; i += this.chunkSize) {
        socket.write(text.slice(i, i + this.chunkSize));
        await new Promise(resolve => setTimeout(resolve, 1));
      }
    };
    let mails = this.mails.slice(); // The maildrop is locked for the session
    let deleted = new Set<number>();
    let user: string | null = null;
    let loggedIn = false;
    let secure = this.tlsMode == "implicit";
    let mail = (arg: string): FakeMail | null => {
      let number = parseInt(arg);
      return number >= 1 && number <= mails.length && !deleted.has(number) ? mails[number - 1] : null;
    };
    await send(this.greeting + "\r\n");
    while (true) {
      let line = await reader.readLine();
      if (line === null) {
        return;
      }
      this.commands.push(line);
      let [command, ...args] = line.split(" ");
      command = command.toUpperCase();
      if (command == "CAPA") {
        let capabilities = this.capabilities.filter(capa => secure || !["USER", "SASL PLAIN XOAUTH2"].includes(capa));
        if (this.tlsMode == "starttls" && !secure) {
          capabilities.push("STLS");
        }
        await send("+OK\r\n" + capabilities.map(capa => capa + "\r\n").join("") + ".\r\n");
      } else if (command == "STLS") {
        if (this.tlsMode != "starttls" || secure) {
          await send("-ERR Not available\r\n");
          continue;
        }
        await send("+OK Begin TLS\r\n");
        reader.stop();
        socket = new tls.TLSSocket(socket, { isServer: true, cert: kCert, key: kKey });
        reader = new LineReader(socket);
        secure = true;
      } else if (command == "USER") {
        user = args[0];
        await send("+OK\r\n");
      } else if (command == "PASS") {
        loggedIn = user == this.username && args[0] == this.password;
        await send(loggedIn ? "+OK Logged in\r\n" : "-ERR [AUTH] Authentication failed\r\n");
      } else if (command == "AUTH") {
        await send("+ \r\n");
        let response = Buffer.from(await reader.readLine() ?? "", "base64").toString();
        this.commands.push(response);
        if (args[0] == "PLAIN") {
          let [, username, password] = response.split("\0");
          loggedIn = username == this.username && password == this.password;
        } else if (args[0] == "XOAUTH2") {
          let match = response.match(/^user=([^\x01]*)\x01auth=Bearer ([^\x01]*)\x01\x01$/);
          loggedIn = !!match && match[1] == this.username && match[2] == this.token;
          if (!loggedIn) { // like Gmail: The error in a challenge, then -ERR after an empty line
            await send("+ " + Buffer.from(JSON.stringify({ status: "400" })).toString("base64") + "\r\n");
            this.commands.push(await reader.readLine() ?? "");
          }
        }
        await send(loggedIn ? "+OK Logged in\r\n" : "-ERR [AUTH] Invalid credentials\r\n");
      } else if (!loggedIn) {
        await send("-ERR [AUTH] Please log in first\r\n");
      } else if (command == "STAT") {
        let remaining = mails.filter((m, i) => !deleted.has(i + 1));
        await send(`+OK ${remaining.length} ${remaining.reduce((sum, m) => sum + m.mime.length, 0)}\r\n`);
      } else if (command == "UIDL" || command == "LIST") {
        let info = (m: FakeMail) => command == "UIDL" ? m.uidl : m.mime.length;
        if (args[0]) {
          let m = mail(args[0]);
          await send(m ? `+OK ${args[0]} ${info(m)}\r\n` : "-ERR No such message\r\n");
        } else {
          await send("+OK\r\n" + mails.map((m, i) => deleted.has(i + 1) ? "" : `${i + 1} ${info(m)}\r\n`).join("") + ".\r\n");
        }
      } else if (command == "RETR" || command == "TOP") {
        let m = mail(args[0]);
        if (!m) {
          await send("-ERR No such message\r\n");
          continue;
        }
        let body = m.mime.replace(/\r?\n/g, "\r\n").replace(/^\./gm, "..");
        if (!body.endsWith("\r\n")) {
          body += "\r\n";
        }
        await send(`+OK ${m.mime.length} octets\r\n` + body + ".\r\n");
      } else if (command == "DELE") {
        let m = mail(args[0]);
        if (m) {
          deleted.add(parseInt(args[0]));
        }
        await send(m ? "+OK Marked\r\n" : "-ERR No such message\r\n");
      } else if (command == "RSET") {
        deleted.clear();
        await send("+OK\r\n");
      } else if (command == "NOOP") {
        await send("+OK\r\n");
      } else if (command == "QUIT") {
        let deletedUIDLs = mails.filter((m, i) => deleted.has(i + 1)).map(m => m.uidl);
        this.mails = this.mails.filter(m => !deletedUIDLs.includes(m.uidl));
        await send("+OK Bye\r\n");
        socket.end();
        return;
      } else {
        await send("-ERR Unknown command\r\n");
      }
    }
  }
}

class LineReader {
  protected buffer = "";
  protected waiting: ((line: string | null) => void)[] = [];
  protected closed = false;
  protected onData = (data: Buffer) => {
    this.buffer += data.toString("latin1");
    this.deliver();
  };
  protected onClose = () => {
    this.closed = true;
    this.deliver();
  };

  constructor(protected socket: net.Socket) {
    socket.on("data", this.onData);
    socket.on("close", this.onClose);
  }

  /** @returns The next line, without CRLF. null at connection end. */
  readLine(): Promise<string | null> {
    return new Promise(resolve => {
      this.waiting.push(resolve);
      this.deliver();
    });
  }

  protected deliver() {
    while (this.waiting.length) {
      let end = this.buffer.indexOf("\r\n");
      if (end < 0) {
        if (this.closed) {
          this.waiting.shift()(null);
          continue;
        }
        return;
      }
      let line = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 2);
      this.waiting.shift()(line);
    }
  }

  /** Before wrapping the socket in TLS */
  stop() {
    this.socket.off("data", this.onData);
    this.socket.off("close", this.onClose);
  }
}

/** Self-signed certificate for localhost and 127.0.0.1, valid until 2036 */
const kCert = fs.readFileSync(fileURLToPath(new URL("./localhost-cert.pem", import.meta.url)));
const kKey = fs.readFileSync(fileURLToPath(new URL("./localhost-key.pem", import.meta.url)));
