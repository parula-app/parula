import { MailAccount, type ConfigSource } from "../MailAccount";
import { Account, AuthMethod } from "../../Abstract/Account";
import { TCPAccount, TLSSocketType } from "../../Abstract/TCPAccount";
import type { SMTPAccount } from "../SMTP/SMTPAccount";
import type { Calendar } from "../../Calendar/Calendar";
import type { Addressbook } from "../../Contacts/Addressbook";
import type { FileSharingAccount } from "../../Files/FileSharingAccount";
import type { ChatAccount } from "../../Chat/ChatAccount";
import type { MeetAccount } from "../../Meet/MeetAccount";
import { newAccountForProtocol } from "../AccountsList/MailAccounts";
import { newCalendarForProtocol } from "../../Calendar/AccountsList/Calendars";
import { newAddressbookForProtocol } from "../../Contacts/AccountsList/Addressbooks";
import { newFileSharingAccountForProtocol } from "../../Files/AccountsList/FileSharingAccounts";
import { newChatAccountForProtocol } from "../../Chat/AccountsList/ChatAccounts";
import { newMeetAccountForProtocol } from "../../Meet/AccountsList/MeetAccounts";
import { SetupInfo } from "./SetupInfo";
import { OWAAccount } from "../OWA/OWAAccount";
import type { WebBasedAuth } from "../../Auth/WebBasedAuth";
import { OWAAuth } from "../../Auth/OWAAuth";
import { OAuth2 } from "../../Auth/OAuth2";
import { getOAuth2BuiltIn } from "../../Auth/OAuth2Util";
import JXON from "../../../../lib/util/JXON";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { logErrorToServer } from "../../util/error";
import { ensureArray, assert } from "../../util/util";
import { ArrayColl } from "svelte-collections";

export function readConfigFromXML(autoconfigXMLStr: string, forDomain: string | null, source: ConfigSource): ArrayColl<MailAccount> {
  let autoconfigXML = JXON.parse(autoconfigXMLStr);
  if (typeof (autoconfigXML) != "object" ||
    !autoconfigXML?.clientConfig?.emailProvider) {
    console.log("autoconfig xml", JSON.stringify(autoconfigXML, null, 2), autoconfigXML);
    throw new Error("Config syntax error");
  }
  let fullXML = autoconfigXML.clientConfig;
  let xml = autoconfigXML.clientConfig.emailProvider;

  let configs = new ArrayColl<MailAccount>();

  forDomain ??= sanitize.hostname(xml.domain);
  let displayName = sanitize.label(xml.displayName, sanitize.label(xml["@id"], forDomain));
  let realName = sanitize.label(autoconfigXML.clientConfig.realName, null);
  let emailAddress = sanitize.emailAddress(autoconfigXML.clientConfig.emailAddress, null);
  //let domains = xml.$domain.map(domain => sanitize.hostname(domain));
  assert(!forDomain || ensureArray(xml.$domain).includes(forDomain), "Need proper <domain> in XML");
  let firstError: Error;

  // Incoming server
  for (let iX of ensureArray(xml.$incomingServer)) {
    try {
      let config = readServer(iX, displayName, fullXML, source, newAccountForProtocol) as MailAccount;
      config.emailAddress ??= emailAddress;
      config.realname = realName;
      configs.push(config);
    } catch (ex) {
      firstError = ex;
    }
  }
  if (!configs.length) {
    throw firstError ?? new Error(`No working <incomingServer> in autoconfig XML for ${forDomain} found`);
  }
  firstError = null;

  // Outgoing server
  let imapConfigs = configs.filterOnce(config => config.protocol == "imap" || config.protocol == "pop3");
  if (imapConfigs.hasItems) {
    let outgoing = readFirstServer(xml.$outgoingServer, displayName, fullXML, source, newAccountForProtocol) as MailAccount;
    if (!outgoing) {
      throw firstError ?? new Error(`No working <outgoingServer> in autoconfig XML for ${forDomain} found`);
    }
    for (let config of imapConfigs) {
      let outgoingClone = newAccountForProtocol(outgoing.protocol);
      outgoingClone.cloneFrom(outgoing);
      config.outgoing = outgoingClone as any as SMTPAccount;
    }
  }

  let calendar = readFirstServer(fullXML.$calendar, displayName, fullXML, source, newCalendarForProtocol) as Calendar;
  let addressbook = readFirstServer(fullXML.$addressbook, displayName, fullXML, source, newAddressbookForProtocol) as Addressbook;
  let fileShare = readFirstServer(fullXML.$fileShare, displayName, fullXML, source, newFileSharingAccountForProtocol) as any as FileSharingAccount;
  let chat = readFirstServer(fullXML.$chatServer, displayName, fullXML, source, newChatAccountForProtocol) as any as ChatAccount;
  let meet = readFirstServer(fullXML.$videoConference, displayName, fullXML, source, newMeetAccountForProtocol) as any as MeetAccount;
  for (let config of configs) {
    break; // TODO Fix calendarURL in CalDAV / CardDAV, and implement DB to save WebDAV accounts
    let setup = config.setup ??= new SetupInfo();
    setup.calendar = calendar;
    setup.addressbook = addressbook;
    setup.fileShare = fileShare;
    setup.chat = chat;
    setup.meet = meet;
  }

  return configs;
}

/**
 * @param {JXON} xml <incomingServer> or <outgoingServer>
 */
function readServer(xml: any, displayName: string, fullXML: any, source: ConfigSource, newAccount: (protocol: string) => Account): Account {
  let protocol = sanitize.enum(xml["@type"], ["pop3", "imap", "jmap", "smtp", "ews", "owa", "activesync", "graph", "exchange", "caldav", "carddav", "webdav"], null);
  assert(protocol, `Need type for <incomingServer> in autoconfig XML for ${displayName}`);

  if (protocol == "exchange") { // Backwards compat
    let ewsURL = sanitize.url(xml.ewsURL, null);
    let owaURL = sanitize.url(xml.owaURL, null);
    let activeSyncURL = sanitize.url(xml.easURL, null);
    assert(ewsURL || owaURL || activeSyncURL, "Malformed or unknown Exchange config");
    // Return only the most preferred config (for this backwards compat)
    protocol = ewsURL ? "ews" : owaURL ? "owa" : "activesync";
    xml.url = ewsURL ?? owaURL ?? activeSyncURL;
    assert(xml.url, "Need URL for Exchange servers");
  }

  let account = newAccount(protocol);

  account.name = displayName;
  account.url = sanitize.url(xml.url, null);
  account.username = sanitize.string(xml.username); // may be a %VARIABLE%
  if (xml.password) {
    account.password = sanitize.string(xml.password);
  }

  if (account instanceof TCPAccount) {
    if (account.url) {
      let url = new URL(account.url);
      account.hostname = url.hostname;
      account.port = url.port
        ? sanitize.portTCP(url.port)
        : url.protocol == "https:" ? 443 : url.protocol == "http:" ? 80 : null;
      assert(account.port, "Need port number or known protocol in URL");
      account.tls = account.url.startsWith("https:") ? TLSSocketType.TLS : account.url.startsWith("http:") ? TLSSocketType.Plain : null;
    } else {
      account.hostname = sanitize.hostname(xml.hostname);
      account.port = sanitize.portTCP(xml.port);
      // Take first supported
      account.tls = ensureArray(xml.$socketType).map(socketType => sanitize.translate(socketType, {
        plain: TLSSocketType.Plain,
        SSL: TLSSocketType.TLS,
        STARTTLS: TLSSocketType.STARTTLS
      }, null)).find(v => v !== null);
    }
    assert(account.tls, "No supported <socketType> in autoconfig");
  }

  let authMethods = ensureArray(xml.$authentication).map(auth => sanitize.translate(auth, {
    "password-cleartext": AuthMethod.Password,
    "basic": AuthMethod.Password,
    "OAuth2": AuthMethod.OAuth2,
    "password-encrypted": AuthMethod.CRAMMD5,
    "GSSAPI": AuthMethod.GSSAPI,
    "NTLM": AuthMethod.NTLM,
  }, null)).filter(v => v !== null);
  // Take first supported auth method
  for (let authMethod of authMethods) {
    try {
      account.authMethod = authMethod;
      if (account.authMethod == AuthMethod.OAuth2) {
        account.oAuth2 = getAuthConfig(account, fullXML); // can throw
      }
      break; // success -> use this auth method
    } catch (ex) {
      console.log(account.name + ":", ex?.message ?? ex + "");
      // try next
    }
  }
  assert(account.authMethod, `No supported <authentication> method in autoconfig XML for ${displayName}\n\nGot authentication methods ${JSON.stringify(xml.$authentication, null, 2)}`);

  if (account instanceof MailAccount) {
    account.source = source;
  }
  return account;
}

function getAuthConfig(account: Account, autoConfigXML: any): WebBasedAuth {
  if (account instanceof OWAAccount) {
    return new OWAAuth(account);
  }
  // try built-in
  let oAuth2 = getOAuth2BuiltIn(account);
  if (!oAuth2 && autoConfigXML.oAuth2) {
    try {
      let xml = autoConfigXML.oAuth2;
      oAuth2 = new OAuth2(
        account,
        sanitize.url(xml.tokenURL),
        sanitize.url(xml.authURL),
        sanitize.url(xml.authDoneURL, null),
        sanitize.nonemptystring(xml.scope),
        sanitize.nonemptystring(xml.clientID, "open"),
        sanitize.nonemptystring(xml.clientSecret, null),
        sanitize.boolean(xml.usePKCE, false)
      );
    } catch (ex) {
      console.error(ex);
    }
  }
  assert(oAuth2, "No suitable OAuth2 config found, neither in AutoConfig XML, nor built-in");
  return oAuth2;
}

function readFirstServer(serversX: any, displayName: string, fullXML: any, source: ConfigSource, newAccount: (protocol: string) => Account): Account {
  for (let accX of ensureArray(serversX)) {
    try {
      return readServer(accX, displayName, fullXML, source, newAccount);
    } catch (ex) {
      logErrorToServer(ex);
    }
  }
}
