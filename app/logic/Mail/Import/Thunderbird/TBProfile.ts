import type { MailAccount } from "../../MailAccount";
import { AuthMethod } from "../../../Abstract/Account";
import { TLSSocketType } from "../../../Abstract/TCPAccount";
import type { MailIdentity } from "../../MailIdentity";
import type { SMTPAccount } from "../../SMTP/SMTPAccount";
import { IMAPAccount } from "../../IMAP/IMAPAccount";
import { POP3Account } from "../../POP3/POP3Account";
import { EWSAccount } from "../../EWS/EWSAccount";
import { OWAAccount } from "../../OWA/OWAAccount";
import { ActiveSyncAccount } from "../../ActiveSync/ActiveSyncAccount";
import { newAccountForProtocol } from "../../AccountsList/MailAccounts";
import { kStandardPorts } from "../../AutoConfig/configInfo";
import { getOAuth2BuiltIn } from "../../../Auth/OAuth2Util";
import { appGlobal } from "../../../app";
import { sanitize } from "../../../../../lib/util/sanitizeDatatypes";
import { arrayRemove, assert, NotReached } from "../../../util/util";
import { parse as parseINI } from 'ini';

/** Finds the list of Thunderbird profiles of the current OS user,
 * with the directory root path of the profile. */
export class ThunderbirdProfile {
  name: string;
  /** The root directory of the TB profile, e.g. /home/USER/.thunderbird/dfhdhdh.default/ */
  path: string;
  relativePath: string;
  isDefault: boolean;
  isLocked: boolean;
  isRelative: boolean;
  /** key = pref name, e.g. "mail.foo" value: pref value, e.g. 993, true, or "imap.example.com" */
  prefs: Record<string, any>;

  async readMailAccounts(): Promise<MailAccount[]> {
    let accounts: MailAccount[] = [];
    await this.readPrefs();
    let accountIDs = sanitize.string(this.prefs["mail.accountmanager.accounts"], null)?.split(",");
    assert(accountIDs && accountIDs.length, "  No accounts found for " + this.path);

    for (let accountID of accountIDs) {
      let account = this.readMailAccount(accountID);
      if (account) {
        (account as any).tbID = accountID;
        accounts.push(account);
      }
    }

    // In case the account identity wasn't linked with an SMTP server,
    // associate them now, based on the username.
    let smtpIDs = sanitize.string(this.prefs["mail.smtpservers"], null)?.split(",") ?? [];
    for (let smtpID of smtpIDs) {
      let smtp = this.readSMTPServer(smtpID);
      if (!smtp) {
        continue;
      }
      for (let account of accounts) {
        if (account.outgoing) {
          continue;
        }
        if (account.username == smtp.username &&
            (account instanceof IMAPAccount || account instanceof POP3Account)) {
          account.outgoing = smtp;
          smtp.id = account.id + "-" + smtp.id.replace("tb-", "");
        }
      }
    }
    accounts = accounts.filter(acc => !((acc instanceof IMAPAccount || acc instanceof POP3Account) && !acc.outgoing));

    // Make default account the first in the array
    let defaultAccountName = this.prefs["mail.accountmanager.defaultaccount"];
    if (defaultAccountName) {
      let defaultAccount = accounts.find(acc => (acc as any).tbID == defaultAccountName);
      if (defaultAccount) {
        arrayRemove(accounts, defaultAccount);
        accounts.unshift(defaultAccount);
      }
    }
    return accounts;
  }

  readMailAccount(accountID: string): MailAccount | null {
    try {
      let prefBranch = `mail.account.${accountID}`;
      let serverID = this.prefs[`${prefBranch}.server`];
      let protocol = sanitize.translate(this.prefs[`mail.server.${serverID}.type`], {
        "imap": "imap",
        "pop3": "pop3",
        "owl": "owa",
        "owl-ews": "ews",
        "owl-eas": "activesync",
        "exquilla": "ews",
      }, null);
      if (!protocol) {
        return null;
      }
      //console.log("  reading", accountID, "server", serverID, "protocol", protocol, "hostname", this.prefs[`mail.server.${serverID}.hostname`]);
      let acc = newAccountForProtocol(protocol);
      acc.id = "tb-" + accountID + "-" + acc.id;
      this.readMailServer(serverID, acc);

      if (acc.authMethod == AuthMethod.OAuth2) {
        let hostname = acc.hostname ?? "none";
        if (acc instanceof EWSAccount || acc instanceof OWAAccount || acc instanceof ActiveSyncAccount) {
          hostname = "outlook.office365.com";
        }
        acc.oAuth2 = getOAuth2BuiltIn(acc);
        assert(acc.oAuth2, `${acc.name}: Need OAuth2 config for host ${hostname}`);
      }

      let identityIDs = this.prefs[`${prefBranch}.identities`]?.split(",");
      acc.identities.addAll(identityIDs.map(id => this.readMailIdentity(id, acc)));
      assert(acc.identities.hasItems, "Identities missing for account " + accountID);
      let mainIdentity = acc.identities.first;
      acc.emailAddress = mainIdentity.emailAddress;
      acc.realname = mainIdentity.realname;

      return acc as any as MailAccount;
    } catch (ex) {
      console.error(ex); // TODO disable errors in production
      return null;
    }
  }

  readMailServer(serverID: string, acc: MailAccount): void {
    let prefBranch = `mail.server.${serverID}`;
    acc.username = sanitize.string(this.prefs[`${prefBranch}.userName`]);
    acc.name = sanitize.label(this.prefs[`${prefBranch}.name`], acc.realname);

    if (acc instanceof EWSAccount) {
      // ewsURL from ExQuilla, and ews_url from Owl in EWS mode
      let ewsURLExQuilla = this.prefs[`${prefBranch}.ewsURL`];
      let ewsURLOwl = this.prefs[`${prefBranch}.ews_url`];
      acc.url = sanitize.url(ewsURLOwl ?? ewsURLExQuilla);
    } else if (acc instanceof OWAAccount) {
      acc.url = sanitize.url(this.prefs[`${prefBranch}.owa_url`]);
    } else if (acc instanceof ActiveSyncAccount) {
      acc.url = sanitize.url(this.prefs[`${prefBranch}.eas_url`]);
    } else if (acc instanceof IMAPAccount || acc instanceof POP3Account) {
      acc.hostname = sanitize.hostname(this.prefs[`${prefBranch}.hostname`]);
      acc.tls = ThunderbirdProfile.convertTLS(this.prefs[`${prefBranch}.socketType`], prefBranch);
      acc.port = ThunderbirdProfile.convertPort(this.prefs[`${prefBranch}.port`], acc as any as MailAccount);
    } else {
      throw new NotReached();
    }
    if (acc instanceof EWSAccount || acc instanceof OWAAccount || acc instanceof ActiveSyncAccount) {
      assert(acc.url, `${acc.name}: Need URL`);
      acc.hostname = new URL(acc.url).hostname;
    }

    acc.authMethod = ThunderbirdProfile.convertAuthMethod(this.prefs[`${prefBranch}.authMethod`]);
  }

  readMailIdentity(identityID: string, account: MailAccount): MailIdentity | null {
    try {
      let identity = account.newIdentity();
      identity.id = "tb-" + identityID;
      let prefBranch = `mail.identity.${identityID}`;
      assert(this.prefs[`${prefBranch}.valid`] !== false, "Identity marked as invalid");
      identity.realname = sanitize.label(this.prefs[`${prefBranch}.fullName`]);
      identity.emailAddress = sanitize.emailAddress(this.prefs[`${prefBranch}.useremail`]);
      let signatureHTML = sanitize.string(this.prefs[`${prefBranch}.htmlSigText`], null);
      if (signatureHTML) {
        if (this.prefs[`${prefBranch}.htmlSigFormat`] === false) {
          signatureHTML = `<pre>${signatureHTML}</pre>`;
        }
        identity.signatureHTML = signatureHTML;
      }

      if (!account.outgoing) {
        let id = this.prefs[`${prefBranch}.smtpServer`];
        if (id) {
          let smtp = this.readSMTPServer(id);
          if (smtp) {
            account.outgoing = smtp;
            smtp.id = sanitize.nonemptystring(account.id + "-" + smtp.id.replace("tb-", ""));
          }
        }
      }
      return identity;
    } catch (ex) {
      console.error(ex); // TODO disable errors in production
      return null;
    }
  }

  readSMTPServer(serverID: string): SMTPAccount | null {
    try {
      let acc = newAccountForProtocol("smtp") as any as SMTPAccount;
      acc.id = "tb-" + serverID;
      let prefBranch = `mail.smtpserver.${serverID}`;
      acc.hostname = this.prefs[`${prefBranch}.hostname`];
      acc.username = this.prefs[`${prefBranch}.username`];
      acc.tls = ThunderbirdProfile.convertTLS(this.prefs[`${prefBranch}.try_ssl`], prefBranch);
      acc.port = ThunderbirdProfile.convertPort(this.prefs[`${prefBranch}.port`], acc as any as MailAccount);
      acc.authMethod = ThunderbirdProfile.convertAuthMethod(this.prefs[`${prefBranch}.authMethod`]);
      return acc;
    } catch (ex) {
      console.error(ex); // TODO disable errors in production
      return null;
    }
  }

  static convertTLS(tbValue: number, prefBranch: string): TLSSocketType {
    // nsMsgSocketType <https://searchfox.org/comm-central/source/mailnews/base/public/MailNewsTypes2.idl#40>
    let tls = sanitize.translate(tbValue, {
      0: TLSSocketType.Plain,
      1: TLSSocketType.STARTTLS,
      2: TLSSocketType.STARTTLS,
      3: TLSSocketType.TLS,
    }, null);
    assert(tls, "Need socketType for server " + prefBranch + ".socketType, got " + tbValue + " "+ typeof tbValue);
    return tls;
  }

  static convertAuthMethod(tbValue: number): AuthMethod {
    // nsMsgSocketType <https://searchfox.org/comm-central/source/mailnews/base/public/MailNewsTypes2.idl#60>
    let authMethod = sanitize.translate(tbValue, {
      0: AuthMethod.Password, // No auth at all, but let's try password
      2: AuthMethod.Password, // "old" = IMAP Login
      3: AuthMethod.Password, // Cleartext Password
      4: AuthMethod.Password, // AuthMethod.CRAMMD5, but not yet supported
      5: null, // Kerberos, not yet supported
      6: AuthMethod.Password, // AuthMethod.NTLM, but not yet supported
      7: null, // External = SSL client cert, but not supported
      8: AuthMethod.Password, // "Secure", deprecated
      9: AuthMethod.Password, // anything
      10: AuthMethod.OAuth2,
    }, AuthMethod.Password);
    assert(authMethod, "Auth method not supported");
    return authMethod;
  }

  static convertPort(tbValue: number, acc: MailAccount): number {
    return sanitize.portTCP(tbValue ??
      kStandardPorts.find(p => p.protocol == acc.protocol && p.tls == acc.tls)?.port);
  }

  /** Result is in `this.prefs` */
  async readPrefs(): Promise<void> {
    if (this.prefs) {
      return;
    }
    let prefsPath = await appGlobal.remoteApp.path.join(this.path, "prefs.js");
    //console.log(`Looking for Thunderbird prefs.js at ${prefsPath}`);
    let prefsText = await appGlobal.remoteApp.fs.readFile(prefsPath, { encoding: "utf-8" });
    prefsText = prefsText.replaceAll("\n\r", "\n").replaceAll("\r", "\n");
    let prefsLines = prefsText.split("\n");
    let prefs = {};
    for (let line of prefsLines) {
      if (!(line.startsWith(`user_pref("`) && line.endsWith(`);`))) {
        continue;
      }
      let nameVal = line.slice(11, -2).split(`", `);
      if (nameVal.length != 2) {
        continue;
      }
      let [name, value] = nameVal;
      try {
        value = JSON.parse(value);
        /*let number = parseInt(value); // convert integers
        if (!isNaN(number)) {
          value = number;
        } else if (value == "true" || value == "false") { // convert booleans
          value = value == "true";
        } else if (typeof (value) == "string") {
          value = value.replace(/\\"/g, `"`).replace(/\\n/g, `\n`); // unescape
        }*/
        prefs[name] = value;
      } catch (ex) {
      }
    }
    this.prefs = prefs;
  }

  static async findProfiles(): Promise<ThunderbirdProfile[]> {
    let baseDir = await this.baseDir();
    let iniPath = await appGlobal.remoteApp.path.join(baseDir, "profiles.ini");
    let iniText: string;
    try {
      iniText = await appGlobal.remoteApp.fs.readFile(iniPath, { encoding: "utf-8" });
    } catch (ex) {
      console.log("Failed to find Thunderbird profiles:", ex?.message);
      return [];
    }
    let iniContents = parseINI(iniText);
    let profiles: ThunderbirdProfile[] = [];
    /*
    [Profile97]
    Name=somename
    Path=i5fo43qd.somename
    IsRelative=1
    Locked=1
    */
    for (let sectionName in iniContents) {
      try {
        let section = iniContents[sectionName];
        if (sectionName.startsWith("Profile")) {
          let profile = new ThunderbirdProfile();
          profile.name = sanitize.nonemptystring(section.Name);
          profile.relativePath = sanitize.nonemptystring(section.Path);
          profile.isRelative = section.IsRelative == "1";
          profile.isLocked = section.Locked == "1";
          profile.isDefault = section.IsDefault == "1";
          if (profile.isRelative) {
            profile.path = await appGlobal.remoteApp.path.join(baseDir, profile.relativePath);
          } else {
            profile.path = profile.relativePath;
          }
          profiles.push(profile);
        }
      } catch (ex) {
        console.error(ex);
      }
    }
    /*
    [Install599705D84171D0F]
    Default = i5fo43qd.somename
    */
    for (let sectionName in iniContents) {
      try {
        let section = iniContents[sectionName];
        if (!sectionName.startsWith("Install")) {
          continue;
        }
        let path = sanitize.string(section.Default, null);
        if (!path) {
          continue;
        }
        let profile = profiles.find(p => p.relativePath == path);
        if (!profile) {
          continue;
        }
        profile.isDefault = true;
      } catch (ex) {
        console.error(ex);
      }
    }
    return profiles;
  }

  static async baseDir(): Promise<string> {
    /*
    Win10: C:\Users\USER\AppData\Roaming\Thunderbird\
    Mac OS X: /Users/USER/Library/Thunderbird/
    Linux: /home/USER/.thunderbird/
    https://support.mozilla.org/de/kb/Benutzerprofile-Thunderbird#thunderbird:win10:tb115
    https://support.mozilla.org/de/kb/Benutzerprofile-Thunderbird#thunderbird:mac:tb115
    https://support.mozilla.org/de/kb/Benutzerprofile-Thunderbird#thunderbird:linux:tb115
    */
    let platform = await appGlobal.remoteApp.platform();
    let dir = await appGlobal.remoteApp.directory(
      platform == "win32" ? "appData" : "home");
    let subdir =
      platform == "darwin" ? "Library/Thunderbird" :
        platform == "win32" ? "Thunderbird" :
          ".thunderbird";
    return await appGlobal.remoteApp.path.join(dir, subdir);
  }
}
