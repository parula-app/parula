import { IMAPAccount } from "../IMAP/IMAPAccount";
import { POP3Account } from "../POP3/POP3Account";
import { SMTPAccount } from "../SMTP/SMTPAccount";
import { AuthMethod } from "../../Abstract/Account";
import { TLSSocketType } from "../../Abstract/TCPAccount";
import { kStandardPorts } from "./configInfo";
import { newAccountForProtocol } from "../AccountsList/MailAccounts";
import { getMX } from "./fetchConfig";
import { PriorityAbortable, ParallelAbortable } from "../../util/flow/Abortable";
import { getBaseDomainFromHost } from "../../util/netUtil";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { assert } from "../../util/util";

/** Tries common hostnames and checks whether an IMAP, POP3 or SMTP server is listening there.
 * Tries various standard ports.
 * @param tryMX (Optional) internal only, to prevent loops
 * @returns The best config (TLS and IMAP, if possible) found */
export async function guessConfig(domain: string, emailAddress: string, abort: AbortController, tryMX = true): Promise<IMAPAccount | POP3Account> {
  domain = sanitize.hostname(domain);

  const kIMAPHostnames = ["imap", "mail", "incoming"];
  const kPOP3Hostnames = ["pop", "pop3", "mail", "incoming"];
  const kSMTPHostnames = ["smtp", "mail", "outgoing"];
  addDomain(kIMAPHostnames, domain);
  addDomain(kPOP3Hostnames, domain);
  addDomain(kSMTPHostnames, domain);

  try {
    let inout = new ParallelAbortable<IMAPAccount | POP3Account | SMTPAccount>(abort, [
      tryIncoming(kIMAPHostnames, kPOP3Hostnames, abort),
      tryOutgoing(kSMTPHostnames, abort),
    ]);
    let [inConfig, outConfig] = await inout.run();

    console.log(inConfig, outConfig);
    assert(inConfig instanceof IMAPAccount || inConfig instanceof POP3Account, "Incoming protocol doesn't fit");
    assert(outConfig instanceof SMTPAccount, "Outgoing protocol doesn't fit");
    inConfig.emailAddress = outConfig.emailAddress = emailAddress;
    inConfig.username = outConfig.username = emailAddress;
    inConfig.outgoing = outConfig;
    return inConfig;
  } catch (ex) {
    console.error(ex);
  }

  try {
    if (!tryMX) {
      throw new Error("don't loop");
    }
    return await tryMXDomain(domain, emailAddress, abort);
  } catch (ex) {
    throw new Error(`Could not guess a config for ${domain}`);
  }
}

function addDomain(arr: string[], domain: string) {
  for (let i = 0; i < arr.length; i++) {
    arr[i] = arr[i] + "." + domain;
  }
}

async function tryIncoming(kIMAPHostnames: string[], kPOP3Hostnames: string[], abort: AbortController): Promise<IMAPAccount | POP3Account> {
  let priorityOrder = new PriorityAbortable(abort, [
    ...kIMAPHostnames.map(hostname => tryIncomingServer("imap", hostname, TLSSocketType.TLS, abort)),
    ...kIMAPHostnames.map(hostname => tryIncomingServer("imap", hostname, TLSSocketType.STARTTLS, abort)),
    ...kPOP3Hostnames.map(hostname => tryIncomingServer("pop3", hostname, TLSSocketType.TLS, abort)),
    ...kPOP3Hostnames.map(hostname => tryIncomingServer("pop3", hostname, TLSSocketType.STARTTLS, abort)),
    ...kIMAPHostnames.map(hostname => tryIncomingServer("imap", hostname, TLSSocketType.Plain, abort)),
    ...kPOP3Hostnames.map(hostname => tryIncomingServer("pop3", hostname, TLSSocketType.Plain, abort)),
  ]);
  return await priorityOrder.run();
}

async function tryOutgoing(kSMTPHostnames: string[], abort: AbortController): Promise<SMTPAccount> {
  let priorityOrder = new PriorityAbortable(abort, [
    ...kSMTPHostnames.map(hostname => trySMTP(hostname, TLSSocketType.TLS, null, abort)),
    ...kSMTPHostnames.map(hostname => trySMTP(hostname, TLSSocketType.STARTTLS, null, abort)),
    ...kSMTPHostnames.map(hostname => trySMTP(hostname, TLSSocketType.STARTTLS, 25, abort)),
    ...kSMTPHostnames.map(hostname => trySMTP(hostname, TLSSocketType.Plain, null, abort)),
    ...kSMTPHostnames.map(hostname => trySMTP(hostname, TLSSocketType.Plain, 25, abort)),
  ]);
  return await priorityOrder.run();
}

async function tryMXDomain(domain: string, emailAddress: string, abort: AbortController): Promise<IMAPAccount | POP3Account> {
  let mx = await getMX(domain, abort);
  let mxDomain = getBaseDomainFromHost(mx);
  return await guessConfig(mxDomain, emailAddress, abort, false);
}

async function tryIncomingServer(protocol: "imap" | "pop3", hostname: string, tls: TLSSocketType, abort: AbortController): Promise<IMAPAccount | POP3Account> {
  let port = kStandardPorts.find(p => p.protocol == protocol && p.tls == tls)?.port ?? null;
  assert(port, "Need port");

  let config = newAccountForProtocol(protocol);
  config.hostname = hostname;
  config.port = port;
  config.tls = tls;
  config.authMethod = AuthMethod.Password;
  config.source = "guess";
  config.errorCallback = () => null;

  try {
    await config.verifyLogin();
  } catch (ex) {
    if (ex.authFail) {
      // OK. Login fail is expected.
    } else {
      //console.log("IMAP config failed", hostname, port, tls, ex?.message, ex);
      throw ex;
    }
  }
  //console.log("IMAP config succeeded", hostname, port, tls, config);
  return config;
}

async function trySMTP(hostname: string, tls: TLSSocketType, port: number | null, abort: AbortController): Promise<SMTPAccount> {
  port = port ?? kStandardPorts.find(p => p.protocol == "smtp" && p.tls == tls)?.port ?? null;
  assert(port, "Need port");

  let config = newAccountForProtocol("smtp");
  config.hostname = hostname;
  config.port = port;
  config.tls = tls;
  config.authMethod = AuthMethod.Password;
  config.source = "guess";
  config.errorCallback = () => null;

  try {
    await config.verifyLogin();
  } catch (ex) {
    if (ex.authFail) {
      // OK. Login fail is expected.
    } else {
      //console.log("SMTP config failed", hostname, port, tls, ex?.message, ex);
      throw ex;
    }
  }
  //console.log("SMTP config succeeded", hostname, port, tls, config);
  return config;
}
