import { appGlobal } from "../../../../logic/app";
import { POP3Account } from "../../../../logic/Mail/POP3/POP3Account";
import type { POP3Folder } from "../../../../logic/Mail/POP3/POP3Folder";
import { newAccountForProtocol } from "../../../../logic/Mail/AccountsList/MailAccounts";
import { DummyMailStorage } from "../../../../logic/Mail/Store/DummyMailStorage";
import { isCertError } from "../../../../logic/Mail/AutoConfig/checkConfig";
import { AuthMethod, ConnectError, LoginError } from "../../../../logic/Abstract/Account";
import { TLSSocketType } from "../../../../logic/Abstract/TCPAccount";
import net from "node:net";
import tls from "node:tls";
import fs from "node:fs";
import { execSync } from "node:child_process";
import { beforeAll, describe, expect, test } from "vitest";

/** The same tests as `pop3.test.ts`, but against real POP3 servers.
 * They are skipped unless `POP3_LIVE` names a JSON file that lists the servers.
 *
 * The servers, their configurations and `start.sh` / `stop.sh` / `reset-mailbox.sh`
 * live outside this repository, in `/home/claude/pop3-servers/`, described in
 * `/home/claude/pop3-servers/README.md`. To run:
 *   /home/claude/pop3-servers/dovecot/start.sh
 *   POP3_LIVE=/home/claude/pop3-servers/servers.json npx vitest run --maxWorkers=1 \
 *     --pool=threads --no-file-parallelism test/logic/Mail/POP3/liveServers.test.ts
 *
 * The JSON is an array of `LiveServer`. Only `name`, `hostname`, `port`, `tls`,
 * `username` and `password` are needed; every other field switches on the tests for
 * a feature that this server has, so that one server can be described by several
 * entries, one per configuration. E.g.:
 *   [{ "name": "Dovecot 2.3.21", "hostname": "127.0.0.1", "port": 11110,
 *      "tls": "plain", "username": "user@example.com", "password": "secret",
 *      "starttlsPort": 11110, "tlsPort": 11115, "cramMD5": true, "apop": true,
 *      "pipelining": true, "stripUserCapability": true,
 *      "maildir": "/home/claude/pop3-servers/dovecot/mail/user@example.com/Maildir",
 *      "reset": "/home/claude/pop3-servers/dovecot/reset-mailbox.sh small" }]
 */

/** Like the backends, but in-process. Objects cross JPC as JSON, so the options do too. */
appGlobal.remoteApp = {
  newTCPSocket: () => new net.Socket(),
  startTLS: (socket: net.Socket, hostname: string, tlsOptions: any) => new Promise((resolve, reject) => {
    let tlsSocket = tls.connect({ socket, servername: hostname, ...JSON.parse(JSON.stringify(tlsOptions)) }, () => resolve(tlsSocket));
    tlsSocket.on("error", reject);
  }),
};

type LiveServer = {
  name: string,
  hostname: string,
  port: number,
  tls: "plain" | "starttls" | "tls",
  username: string,
  password: string,
  /** Ports of the same server for the other transports. 0 or missing = it has none */
  starttlsPort?: number,
  tlsPort?: number,
  /** Maildir of `username` on this machine, to deliver and to check deletions */
  maildir?: string,
  /** Shell commands that refill the maildir, and stop and start the server */
  reset?: string,
  stop?: string,
  restart?: string,
  /** What the server offers */
  pipelining?: boolean,
  cramMD5?: boolean,
  apop?: boolean,
  /** Only mechanisms that we do not implement, e.g. DIGEST-MD5 */
  unsupportedMechanismOnly?: boolean,
  /** The server refuses cleartext logins before STLS */
  plaintextDisallowed?: boolean,
  /** The server has no TLS at all */
  noSTLS?: boolean,
  /** A second session is refused with `-ERR [IN-USE]` */
  lockSession?: boolean,
  /** The server gives every mail the same UIDL, e.g. Dovecot `pop3_uidl_format = %v` */
  duplicateUIDLs?: boolean,
  /** Hide the `USER` capability with a proxy, to reach the client's `AUTH PLAIN` */
  stripUserCapability?: boolean,
  oAuth2?: { mechanism: string, token: string },
  /** A mailbox with more mails than the client lists in full */
  big?: { username: string, password: string, maildir: string, reset: string, count: number },
  /** Logins that must work, despite unusual characters */
  otherPassword?: { username: string, password: string, why: string }[],
};

let servers: LiveServer[] = process.env.POP3_LIVE
  ? JSON.parse(fs.readFileSync(process.env.POP3_LIVE, "utf8"))
  : [];

if (!servers.length) {
  test.skip("Set POP3_LIVE to a servers.json to test against real POP3 servers", () => undefined);
}

/** Sits between the client and the server, so that the test can read the wire,
 * and can take a capability away from the server. */
class WireTap {
  /** In order, one entry per TCP segment */
  readonly wire: { from: "client" | "server", text: string }[] = [];
  readonly hostname = "127.0.0.1";
  /** Capability line to remove from the `CAPA` response, e.g. "USER" */
  removeCapability: string | null = null;
  /** Answer `CAPA` with `-ERR`, like qmail-pop3d */
  refuseCAPA = false;
  /** Close the connection on `QUIT`, without the `+OK` */
  dropOnQUIT = false;
  port: number;
  protected server: net.Server;

  constructor(protected serverHostname: string, protected serverPort: number) {
  }

  async start(): Promise<void> {
    this.server = net.createServer(client => {
      let server = net.connect(this.serverPort, this.serverHostname);
      let capaOutstanding = false;
      client.on("data", data => {
        let text = data.toString("latin1");
        this.wire.push({ from: "client", text });
        capaOutstanding ||= this.refuseCAPA && /(^|\r\n)CAPA\r\n/.test(text);
        if (this.dropOnQUIT && /(^|\r\n)QUIT\r\n/.test(text)) {
          client.destroy();
          return;
        }
        server.write(data);
      });
      server.on("data", data => {
        let text = data.toString("latin1");
        if (capaOutstanding && text.includes("\r\n.\r\n")) { // it fits in one segment, on localhost
          text = "-ERR Unknown command\r\n" + text.slice(text.indexOf("\r\n.\r\n") + 5);
          capaOutstanding = false;
        }
        if (this.removeCapability) {
          text = text.replace(new RegExp(`(^|\r\n)${this.removeCapability}\r\n`), "$1");
        }
        this.wire.push({ from: "server", text });
        client.write(Buffer.from(text, "latin1"));
      });
      for (let [a, b] of [[client, server], [server, client]] as net.Socket[][]) {
        a.on("close", () => b.destroy());
        a.on("error", () => b.destroy());
      }
    });
    await new Promise<void>(resolve => this.server.listen(0, "127.0.0.1", resolve));
    this.port = (this.server.address() as net.AddressInfo).port;
  }

  async stop(): Promise<void> {
    await new Promise(resolve => this.server.close(resolve));
  }

  /** Every command line that the client sent, in order */
  get commands(): string[] {
    return this.wire.filter(event => event.from == "client")
      .map(event => event.text).join("").split("\r\n").filter(line => line);
  }

  /** Whether the client sent a command before the answer to the previous one arrived */
  get pipelined(): boolean {
    return this.wire.some((event, i) => event.from == "client" &&
      (this.wire[i + 1]?.from == "client" || event.text.trimEnd().includes("\r\n")));
  }
}

function newAccount(server: LiveServer, port = server.port, tlsMode = TLSSocketType.Plain): POP3Account {
  let acc = newAccountForProtocol("pop3") as POP3Account;
  acc.hostname = server.hostname;
  acc.port = port;
  acc.tls = tlsMode;
  acc.username = server.username;
  acc.password = server.password;
  acc.emailAddress = server.username;
  acc.name = server.name;
  acc.authMethod = AuthMethod.Password;
  acc.acceptBrokenTLSCerts = true;
  acc.pollIntervalMinutes = 0;
  acc.storage = new DummyMailStorage();
  acc.contentStorage.clear();
  return acc;
}

function newAccountVia(tap: WireTap, server: LiveServer, tlsMode = TLSSocketType.Plain): POP3Account {
  let acc = newAccount(server, tap.port, tlsMode);
  acc.hostname = tap.hostname;
  return acc;
}

function inboxOf(acc: POP3Account): POP3Folder {
  return acc.inbox as POP3Folder;
}

/** Some servers answer `QUIT` before they finished deleting, so give them a moment */
async function waitFor(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !condition(); i++) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

function mailFiles(maildir: string): string[] {
  return ["cur", "new"].flatMap(dir =>
    fs.readdirSync(maildir + "/" + dir).map(name => maildir + "/" + dir + "/" + name));
}

/** Delivers a mail, like an MTA would */
function deliver(maildir: string, subject: string, body: string): void {
  deliverRaw(maildir, subject, new TextEncoder().encode(
    `From: Bob <bob@example.com>\nTo: user@example.com\nSubject: ${subject}\n` +
    `Date: Wed, 02 Sep 2026 12:00:00 +0000\nMessage-ID: <${subject}@example.com>\n\n${body}\n`));
}

function deliverRaw(maildir: string, name: string, mime: Uint8Array): void {
  let file = `${Date.now()}.M9${name.replace(/\W/g, "")}P1.pop3test,S=${mime.length}`;
  fs.writeFileSync(maildir + "/tmp/" + file, mime);
  fs.renameSync(maildir + "/tmp/" + file, maildir + "/new/" + file);
}

/** TLS handshakes, the server's delay after a failed login, and 1500 mails are all slow */
const kTimeout = 60000;

function decode(mime: Uint8Array): string {
  return new TextDecoder().decode(mime);
}

for (let server of servers) {
  describe(server.name, () => {
    let plaintextLoginWorks = !server.plaintextDisallowed && !server.unsupportedMechanismOnly && !server.oAuth2;

    test.runIf(plaintextLoginWorks)("USER/PASS", async () => {
      let tap = new WireTap(server.hostname, server.port);
      await tap.start();
      let acc = newAccountVia(tap, server);
      await acc.verifyLogin();
      expect(tap.commands).toContain(`USER ${server.username}`);
      expect(tap.commands).toContain(`PASS ${server.password}`);
      expect(tap.commands).toContain("QUIT");
      await tap.stop();
    }, kTimeout);

    test.runIf(plaintextLoginWorks)("Wrong password and unknown user are both an auth failure", async () => {
      let acc = newAccount(server);
      acc.password = "wrong-password";
      let ex = await acc.verifyLogin().catch(ex => ex);
      expect(ex).toBeInstanceOf(LoginError);
      expect(ex.authFail).toBe(true);

      acc = newAccount(server);
      acc.username = "nosuchuser@example.com";
      ex = await acc.verifyLogin().catch(ex => ex);
      expect(ex).toBeInstanceOf(LoginError);
      expect(ex.authFail).toBe(true);
    }, kTimeout);

    test.runIf(server.plaintextDisallowed)("Cleartext login refused: The reason reaches the user", async () => {
      let tap = new WireTap(server.hostname, server.port);
      await tap.start();
      let acc = newAccountVia(tap, server);
      let ex = await acc.verifyLogin().catch(ex => ex);
      expect(ex.message).toMatch(/[Pp]laintext authentication|TLS/);
      expect(tap.commands).not.toContain("RETR 1");
      await tap.stop();
    }, kTimeout);

    test.runIf(server.plaintextDisallowed && !!server.starttlsPort)("STARTTLS makes the same login work", async () => {
      let tap = new WireTap(server.hostname, server.starttlsPort);
      await tap.start();
      let acc = newAccountVia(tap, server, TLSSocketType.STARTTLS);
      await acc.verifyLogin();
      // Everything after STLS is encrypted, so the tap sees only the first CAPA
      expect(tap.commands.slice(0, 2)).toEqual(["CAPA", "STLS"]);
      expect(tap.commands.filter(command => command.startsWith("PASS"))).toEqual([]);
      await tap.stop();
    }, kTimeout);

    test.runIf(server.cramMD5)("CRAM-MD5", async () => {
      let tap = new WireTap(server.hostname, server.port);
      await tap.start();
      let acc = newAccountVia(tap, server);
      acc.authMethod = AuthMethod.CRAMMD5;
      await acc.verifyLogin();
      expect(tap.commands).toContain("AUTH CRAM-MD5");
      await tap.stop();
    }, kTimeout);

    test.runIf(server.apop && !server.cramMD5)("APOP, when the server offers no CRAM-MD5", async () => {
      let tap = new WireTap(server.hostname, server.port);
      await tap.start();
      let acc = newAccountVia(tap, server);
      acc.authMethod = AuthMethod.CRAMMD5;
      await acc.verifyLogin();
      expect(tap.commands.find(command => command.startsWith("APOP "))).toBeTruthy();
      await tap.stop();
    }, kTimeout);

    test.runIf(!server.cramMD5 && !server.apop)("Neither CRAM-MD5 nor APOP: A clear error", async () => {
      let acc = newAccount(server);
      acc.authMethod = AuthMethod.CRAMMD5;
      await expect(acc.verifyLogin()).rejects.toThrow(/CRAM-MD5|APOP/);
    }, kTimeout);

    test.runIf(server.unsupportedMechanismOnly)("Only mechanisms that we do not implement", async () => {
      let acc = newAccount(server);
      let ex = await acc.verifyLogin().catch(ex => ex);
      expect(ex).toBeInstanceOf(LoginError);
      expect(ex.message).toMatch(/mechanism/i);
    }, kTimeout);

    test.runIf(!!server.oAuth2)("OAuth2", async () => {
      let tap = new WireTap(server.hostname, server.port);
      await tap.start();
      let acc = newAccountVia(tap, server);
      acc.authMethod = AuthMethod.OAuth2;
      acc.oAuth2 = { isLoggedIn: true, accessToken: server.oAuth2.token, subscribe: () => () => undefined } as any;
      await acc.verifyLogin();
      expect(tap.commands).toContain(`AUTH ${server.oAuth2.mechanism}`);

      acc.oAuth2.accessToken = "expired-token";
      let ex = await acc.verifyLogin().catch(ex => ex);
      expect(ex).toBeInstanceOf(LoginError);
      expect(ex.authFail).toBe(true);
      await tap.stop();
    }, kTimeout);

    test.runIf(server.stripUserCapability)("AUTH PLAIN, when the server offers no USER", async () => {
      let tap = new WireTap(server.hostname, server.port);
      tap.removeCapability = "USER";
      await tap.start();
      let acc = newAccountVia(tap, server);
      await acc.verifyLogin();
      expect(tap.commands).toContain("AUTH PLAIN");
      expect(tap.commands.filter(command => command.startsWith("USER "))).toEqual([]);
      await tap.stop();
    }, kTimeout);

    test.runIf(plaintextLoginWorks)("A server without CAPA", async () => {
      let tap = new WireTap(server.hostname, server.port);
      tap.refuseCAPA = true;
      await tap.start();
      let acc = newAccountVia(tap, server);
      await acc.verifyLogin();
      expect(tap.commands).toContain(`USER ${server.username}`);
      await tap.stop();
    }, kTimeout);

    test.runIf(server.lockSession)("Another session holds the maildrop: Transient, not an auth failure", async () => {
      let first = newAccount(server);
      let connection = await first.connect();
      let second = newAccount(server);
      let ex = await second.verifyLogin().catch(ex => ex);
      await connection.quit();
      expect(ex).toBeInstanceOf(ConnectError);
      expect(ex.authFail).not.toBe(true);
      expect(ex.message).not.toMatch(/password/i);
    }, kTimeout);

    test.runIf(server.noSTLS)("STARTTLS against a server without TLS: No cleartext fallback", async () => {
      let tap = new WireTap(server.hostname, server.port);
      await tap.start();
      let acc = newAccountVia(tap, server, TLSSocketType.STARTTLS);
      await expect(acc.verifyLogin()).rejects.toThrow();
      expect(tap.commands.filter(command => command.startsWith("PASS"))).toEqual([]);
      await tap.stop();
    }, kTimeout);

    test.runIf(!!server.starttlsPort && !server.plaintextDisallowed)("STARTTLS with a self-signed certificate", async () => {
      let acc = newAccount(server, server.starttlsPort, TLSSocketType.STARTTLS);
      acc.acceptBrokenTLSCerts = false;
      let ex = await acc.verifyLogin().catch(ex => ex);
      expect(ex.code).toBe("DEPTH_ZERO_SELF_SIGNED_CERT");
      expect(isCertError(ex)).toBe(true);

      acc.acceptBrokenTLSCerts = true;
      await acc.verifyLogin();
    }, kTimeout);

    test.runIf(!!server.tlsPort)("Implicit TLS with a self-signed certificate", async () => {
      let acc = newAccount(server, server.tlsPort, TLSSocketType.TLS);
      acc.acceptBrokenTLSCerts = false;
      let ex = await acc.verifyLogin().catch(ex => ex);
      expect(ex.code).toBe("DEPTH_ZERO_SELF_SIGNED_CERT");
      expect(isCertError(ex)).toBe(true);

      acc.acceptBrokenTLSCerts = true;
      await acc.verifyLogin();
    }, kTimeout);

    for (let other of server.otherPassword ?? []) {
      test(`Login with a ${other.why}`, async () => {
        let acc = newAccount(server);
        acc.username = other.username;
        acc.password = other.password;
        await acc.verifyLogin();
      }, kTimeout);
    }

    describe.runIf(server.maildir && !server.duplicateUIDLs)("Mails", () => {
      beforeAll(() => {
        execSync(server.reset);
      });

      test("Downloads the mails once, and new ones later", async () => {
        execSync(server.reset);
        let tap = new WireTap(server.hostname, server.port);
        await tap.start();
        let acc = newAccountVia(tap, server);
        await acc.loginAndStartup(false);
        let inbox = inboxOf(acc);
        expect(inbox.messages.contents.map(msg => msg.subject).sort())
          .toEqual(["BareLF", "CRLFStored", "Dots", "First", "Large", "Second", "Third"]);
        expect(inbox.messages.first.downloadComplete).toBe(true);
        expect(inbox.messages.contents.every(msg => msg.isNewArrived)).toBe(false); // existing mailbox
        expect(inbox.countTotal).toBe(7);
        expect(inbox.downloaded.length).toBe(7);
        expect(tap.commands.filter(command => command.startsWith("DELE"))).toEqual([]); // leave on server

        // Second check: Nothing new
        tap.wire.length = 0;
        expect((await inbox.getNewMessages()).length).toBe(0);
        expect(tap.commands.filter(command => command.startsWith("RETR"))).toEqual([]);

        // Third check: A newly delivered mail
        deliver(server.maildir, "Delivered", "A mail that arrived between two checks.\r\n");
        tap.wire.length = 0;
        let newMsgs = await inbox.getNewMessages();
        expect(newMsgs.contents.map(msg => msg.subject)).toEqual(["Delivered"]);
        expect(newMsgs.first.isNewArrived).toBe(true);
        expect(tap.commands.filter(command => command.startsWith("RETR"))).toEqual(["RETR 8"]);
        expect(inbox.messages.length).toBe(8);
        await tap.stop();
      }, 60000);

      test("Dot-stuffed, bare LF and large mails arrive byte-correct", async () => {
        execSync(server.reset);
        let acc = newAccount(server);
        await acc.loginAndStartup(false);
        let inbox = inboxOf(acc);

        let dots = inbox.messages.find(msg => msg.subject == "Dots");
        expect(decode(dots.mime)).toContain(
          "Line one\r\n.Line starting with a dot\r\n..Two dots\r\n+OK not a status line\r\n" +
          "-ERR neither\r\n.\r\nlast line after a lone dot\r\n");
        expect(dots.text).toContain("+OK not a status line");

        let bareLF = inbox.messages.find(msg => msg.subject == "BareLF");
        expect(decode(bareLF.mime)).toContain(
          "Bare LF body line one\r\nBare LF body line two\r\n.dot after bare LF\r\n");
        expect(decode(bareLF.mime)).not.toMatch(/[^\r]\n/); // the server made it CRLF

        let large = inbox.messages.find(msg => msg.subject == "Large");
        expect(large.mime.length).toBeGreaterThan(2 * 1024 * 1024);
        expect(decode(large.mime)).toContain("\r\nLine 30000 xxx");

        // A maildir stores bare LF, but not every MTA does: this one is stored with CRLF
        let stored = inbox.messages.find(msg => msg.subject == "CRLFStored");
        expect(stored.text).toContain("CRLF stored body line one");
      }, 60000);

      test.runIf(server.pipelining)("PIPELINING is used, and the mails still arrive without it", async () => {
        execSync(server.reset);
        let tap = new WireTap(server.hostname, server.port);
        await tap.start();
        let acc = newAccountVia(tap, server);
        await acc.loginAndStartup(false);
        expect(inboxOf(acc).messages.length).toBe(7);
        expect(tap.pipelined).toBe(true);

        // The same server, with PIPELINING taken away
        tap.removeCapability = "PIPELINING";
        tap.wire.length = 0;
        acc = newAccountVia(tap, server);
        await acc.loginAndStartup(false);
        expect(inboxOf(acc).messages.length).toBe(7);
        expect(tap.pipelined).toBe(false);
        await tap.stop();
      }, 60000);

      test("Deletes the mails from the server right after the download", async () => {
        execSync(server.reset);
        let acc = newAccount(server);
        acc.leaveOnServer = false;
        await acc.loginAndStartup(false);
        expect(inboxOf(acc).messages.length).toBe(7);
        await waitFor(() => !mailFiles(server.maildir).length);
        expect(mailFiles(server.maildir)).toEqual([]);
      }, 60000);

      test("Deletes the mails from the server after some days", async () => {
        execSync(server.reset);
        let acc = newAccount(server);
        acc.deleteAfterDays = 7;
        let tap = new WireTap(server.hostname, server.port);
        await tap.start();
        acc.hostname = tap.hostname;
        acc.port = tap.port;
        await acc.loginAndStartup(false);
        let inbox = inboxOf(acc);
        expect(tap.commands.filter(command => command.startsWith("DELE"))).toEqual([]);
        expect(mailFiles(server.maildir).length).toBe(7);

        let eightDaysAgo = new Date();
        eightDaysAgo.setDate(eightDaysAgo.getDate() - 8);
        let old = inbox.messages.find(msg => msg.subject == "Second");
        inbox.downloaded.set(old.uidl, eightDaysAgo);
        tap.wire.length = 0;
        await inbox.getNewMessages();
        expect(tap.commands.filter(command => command.startsWith("DELE")).length).toBe(1);
        await waitFor(() => mailFiles(server.maildir).length == 6);
        expect(mailFiles(server.maildir).length).toBe(6);

        await inbox.getNewMessages();
        expect(inbox.downloaded.length).toBe(6); // forgotten, now that it is gone
        expect(inbox.messages.length).toBe(7); // but still here locally
        await tap.stop();
      }, 60000);

      test("Mails that the MIME parser may not like are downloaded exactly once", async () => {
        execSync(server.reset);
        let acc = newAccount(server);
        await acc.loginAndStartup(false);
        let inbox = inboxOf(acc);
        let before = inbox.messages.length;

        let bytes = new Uint8Array(256);
        for (let i = 0; i < 256; i++) {
          bytes[i] = i;
        }
        deliverRaw(server.maildir, "binary", new Uint8Array([
          ...new TextEncoder().encode("From: Bob <bob@example.com>\nSubject: Binary\n\n"), ...bytes]));
        deliverRaw(server.maildir, "noheaders", new TextEncoder().encode("This mail has no headers at all.\n"));
        deliverRaw(server.maildir, "empty", new TextEncoder().encode(""));

        let newMsgs = await inbox.getNewMessages();
        expect(newMsgs.length).toBe(3);
        expect(inbox.messages.length).toBe(before + 3);
        // Not offered again, whatever the parser made of them
        expect((await inbox.getNewMessages()).length).toBe(0);
      }, kTimeout);

      test("An empty mailbox", async () => {
        execSync(server.reset);
        let acc = newAccount(server);
        acc.leaveOnServer = false;
        await acc.loginAndStartup(false);
        let inbox = inboxOf(acc);
        await waitFor(() => !mailFiles(server.maildir).length);
        expect((await inbox.getNewMessages()).length).toBe(0);
        expect(inbox.downloaded.length).toBe(0);
      }, kTimeout);

      test("Downloads a mail again, when the local copy is gone", async () => {
        execSync(server.reset);
        let acc = newAccount(server);
        await acc.loginAndStartup(false);
        let msg = inboxOf(acc).messages.find(msg => msg.subject == "Dots");
        let mime = msg.mime;
        msg.mime = null;
        await msg.download();
        expect(decode(msg.mime)).toEqual(decode(mime));
      }, kTimeout);

      test("A server that closes the connection instead of answering QUIT", async () => {
        execSync(server.reset);
        let tap = new WireTap(server.hostname, server.port);
        tap.dropOnQUIT = true;
        await tap.start();
        let acc = newAccountVia(tap, server);
        await acc.loginAndStartup(false);
        expect(inboxOf(acc).messages.length).toBe(7);
        await tap.stop();
      }, kTimeout);

      test.runIf(server.stop && server.restart)("A server that goes away mid-session, and the recovery", async () => {
        execSync(server.reset);
        let acc = newAccount(server);
        await acc.loginAndStartup(false);
        let inbox = inboxOf(acc);
        deliver(server.maildir, "AfterRestart", "Downloaded after the server came back.\r\n");

        let failed = inbox.getNewMessages();
        execSync(server.stop);
        let ex = await failed.catch(ex => ex);
        expect(ex).toBeInstanceOf(Error);
        expect(ex.message).toMatch(/server|connection|closed|refused/i);

        execSync(server.restart);
        let newMsgs = await inbox.getNewMessages();
        expect(newMsgs.contents.map(msg => msg.subject)).toEqual(["AfterRestart"]);
      }, 120000);
    });

    // Known limitation: `downloaded` is keyed by the UIDL, so when the server gives
    // several mails the same one, only the first of them is ever downloaded.
    // `test.fails` passes while that is so, and reports it when it is fixed.
    if (server.duplicateUIDLs) {
      test.fails("A server that gives every mail the same UIDL", async () => {
        execSync(server.reset);
        let acc = newAccount(server);
        await acc.loginAndStartup(false);
        let inbox = inboxOf(acc);
        let first = inbox.messages.length;
        deliver(server.maildir, "AfterDuplicates", "A mail delivered after the first check.\n");
        let newMsgs = await inbox.getNewMessages();
        expect({ first, newMsgs: newMsgs.length }).toEqual({ first: 7, newMsgs: 1 });
      }, kTimeout);
    }

    describe.runIf(server.big)("Big mailbox", () => {
      test("Lists all mails once, then only the ones after the last known", async () => {
        execSync(server.big.reset);
        let tap = new WireTap(server.hostname, server.port);
        await tap.start();
        let acc = newAccountVia(tap, server);
        acc.username = server.big.username;
        acc.password = server.big.password;
        await acc.loginAndStartup(false);
        let inbox = inboxOf(acc);
        expect(inbox.messages.length).toBe(server.big.count);
        expect(tap.commands).toContain("UIDL"); // the full listing, the first time

        // Only the mails after the anchor
        deliver(server.big.maildir, "Bulk1501", "One more.\r\n");
        tap.wire.length = 0;
        let newMsgs = await inbox.getNewMessages();
        expect(newMsgs.contents.map(msg => msg.subject)).toEqual(["Bulk1501"]);
        expect(tap.commands.filter(command => command.startsWith("UIDL")))
          .toEqual([`UIDL ${server.big.count}`, `UIDL ${server.big.count + 1}`]);

        // Nothing new: The anchor alone
        tap.wire.length = 0;
        await inbox.getNewMessages();
        expect(tap.commands.slice(tap.commands.indexOf("STAT")))
          .toEqual(["STAT", `UIDL ${server.big.count + 1}`, "QUIT"]);

        // Another client deleted an old mail, so the numbers shifted: A full listing again
        fs.unlinkSync(mailFiles(server.big.maildir).sort()[0]);
        deliver(server.big.maildir, "Bulk1502", "And another.\r\n");
        tap.wire.length = 0;
        newMsgs = await inbox.getNewMessages();
        expect(newMsgs.contents.map(msg => msg.subject)).toEqual(["Bulk1502"]);
        expect(tap.commands.filter(command => command.startsWith("UIDL")))
          .toEqual([`UIDL ${server.big.count + 1}`, "UIDL"]);
        expect(inbox.downloaded.length).toBe(server.big.count + 1);
        await tap.stop();
      }, 300000);

      test("Deletes the whole big mailbox from the server", async () => {
        execSync(server.big.reset);
        let acc = newAccount(server);
        acc.username = server.big.username;
        acc.password = server.big.password;
        acc.leaveOnServer = false;
        await acc.loginAndStartup(false);
        expect(inboxOf(acc).messages.length).toBe(server.big.count);
        await waitFor(() => !mailFiles(server.big.maildir).length);
        expect(mailFiles(server.big.maildir)).toEqual([]);
      }, 300000);
    });
  });
}
