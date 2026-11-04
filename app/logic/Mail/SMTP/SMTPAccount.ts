import { MailAccount } from "../MailAccount";
import { AuthMethod } from "../../Abstract/Account";
import { TLSSocketType } from "../../Abstract/TCPAccount";
import type { EMail } from "../EMail";
import { CreateMIME } from "./CreateMIME";
import { appGlobal } from "../../app";
import { internalError } from "../../util/error";
import { assert } from "../../util/util";

export class SMTPAccount extends MailAccount {
  readonly protocol: string = "smtp";

  get mainAccount(): MailAccount {
    return super.mainAccount as MailAccount;
  }
  set mainAccount(imap: MailAccount) {
    super.mainAccount = imap;
    if (!imap) {
      internalError(new Error(`SMTP account ${this.hostname} lost its IMAP account`));
      super.mainAccount = null;
      return;
    }
    if (imap.outgoing != this) {
      imap.outgoing = this;
    }
  }

  // Should not be called, but do nothing, just in case.
  async syncOnStartup() {
  }

  // We have no folders
  async readFromDB(): Promise<void> {
  }

  protected getTransportOptions() {
    // Auth method
    let usePassword = [
      AuthMethod.Password,
      AuthMethod.CRAMMD5,
      AuthMethod.NTLM,
    ].includes(this.authMethod);
    let useOAuth2 = [
      AuthMethod.OAuth2,
    ].includes(this.authMethod);
    if (useOAuth2) {
      assert(this.mainAccount, `${this.name} SMTP: Need main account`);
      this.oAuth2 = this.mainAccount.oAuth2;
      assert(this.oAuth2?.accessToken, `${this.mainAccount.name} SMTP: Need OAuth2 login from IMAP`);
    }
    let noAuth = this.authMethod == AuthMethod.None;

    return {
      host: this.hostname,
      port: this.port,
      secure: this.tls == TLSSocketType.TLS,
      requireTLS: this.tls == TLSSocketType.STARTTLS,
      ignoreTLS: this.tls == TLSSocketType.Plain,
      tls: {
        minVersion: this.acceptOldTLS ? 'TLSv1' : undefined,
        rejectUnauthorized: !this.acceptBrokenTLSCerts,
      },
      auth: noAuth ? undefined : {
        user: this.username,
        pass: usePassword ? this.password : undefined,
        accessToken: useOAuth2 ? this.oAuth2.accessToken : null,
        type: useOAuth2 ? "OAuth2" : undefined,
        authMethod: this.authMethod == AuthMethod.CRAMMD5 ? "CRAM-MD5" : undefined,
      },
      dnsTimeout: 5000,
      connectionTimeout: 5000,
      greetingTimeout: 20000,
      logger: true,
      disableFileAccess: true,
      disableUrlAccess: true,
    };
  }

  async send(email: EMail): Promise<void> {
    try {
      let mail = await CreateMIME.getNMMail(email);
      let result = await appGlobal.remoteApp.sendMailNodemailer(
        this.getTransportOptions(), mail);
      email.sent = new Date();
      email.received = email.sent;
      email.mime = await appGlobal.remoteApp.getMIMENodemailer(mail, true); // to save the Sent mail
    } catch (ex) {
      if (ex.code == "EAUTH") {
        ex.message = "Check your login, username, and password.\n" + ex.message;
        ex.authFail = true;
      }
      throw ex;
    }
  }

  async verifyLogin(): Promise<void> {
    try {
      await appGlobal.remoteApp.verifyServerNodemailer(this.getTransportOptions());
    } catch (ex) {
      if (ex.code == "EAUTH") {
        ex.message = "Check your login, username, and password:\n" + ex.message;
        ex.authFail = true;
      }
      throw ex;
    }
  }
}
