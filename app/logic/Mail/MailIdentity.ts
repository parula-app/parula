import type { MailAccount } from "./MailAccount";
import { PersonUID } from "../Abstract/PersonUID";
import type { EMail } from "./EMail";
import { SMLHTTPAccount } from "./SML/SMLHTTPAccount";
import type { PublicKey } from "./Encryption/PublicKey";
import type { PrivateKey } from "./Encryption/PrivateKey";
import { privateKeyFromJSON } from "./Encryption/KeyFromJSON";
import { appGlobal } from "../app";
import { sanitize } from "../../../lib/util/sanitizeDatatypes";
import { Observable, notifyChangedProperty } from "../util/Observable";
import { assert } from "../util/util";
import { ArrayColl, type Collection } from "svelte-collections";

export class MailIdentity extends Observable {
  id = crypto.randomUUID();
  readonly account: MailAccount;
  pID: string | number;
  @notifyChangedProperty
  realname: string;
  @notifyChangedProperty
  emailAddress: string;
  @notifyChangedProperty
  replyTo: string | null = null;
  @notifyChangedProperty
  organisation: string | null = null;
  /** Not including signature markers like `-- ` or `footer`,
   * and not including the Mustang signature */
  @notifyChangedProperty
  signatureHTML: string | null = null;
  /** email addresses that should be CCed on every outgoing email */
  @notifyChangedProperty
  sendCC = new ArrayColl<string>();
  /** email addresses that should be CCed on every outgoing email */
  @notifyChangedProperty
  sendBCC = new ArrayColl<string>();
  smlAccount: SMLHTTPAccount;
  readonly encryptionPrivateKeys = new ArrayColl<PublicKey & PrivateKey>();

  constructor(account: MailAccount) {
    super();
    this.account = account;
  }

  get name(): string {
    return this.emailAddress;
  }

  /** The server may forbid deleting some identities */
  get canDelete(): boolean {
    return true;
  }

  /** @param emailAddress may be a catch-all, e.g. `*@example.com` */
  protected setEMailAddress(emailAddress: string) {
    sanitize.emailAddress(emailAddress.replace("*", "any"));
    this.emailAddress = emailAddress;
  }

  async save(): Promise<void> {
    await this.saveToServer();
    await this.account.save();
  }

  /** Only for protocols which store the identities on the server */
  async saveToServer(): Promise<void> {
  }

  /** Only for protocols which store the identities on the server */
  async deleteIt(): Promise<void> {
    await this.deleteFromServer();
    await this.account.save();
  }

  async deleteFromServer(): Promise<void> {
  }

  asPersonUID(): PersonUID {
    return new PersonUID(this.emailAddress, this.realname);
  }

  get isCatchAll(): boolean {
    return this.emailAddress?.includes("*");
  }

  isEMailAddress(emailAddress: string): boolean {
    emailAddress = emailAddress.toLowerCase();
    if (this.isCatchAll) {
      let sp = this.emailAddress.toLowerCase().split("*");
      // Deliberately supporting only 1 `*` placeholder
      return emailAddress.startsWith(sp[0]) && emailAddress.endsWith(sp[1]);
    } else {
      return this.emailAddress.toLowerCase() == emailAddress;
    }
  }

  newEMailFrom(): EMail {
    let email = this.account.newEMailFrom();
    email.identity = this;
    email.from.name = this.name;
    email.from.emailAddress = this.emailAddress;
    return email;
  }

  /** @param config JSON object which contains the data for
   * this specific identity only, i.e. a subtree of the `MailAccount.config`. */
  fromConfigJSON(config: any) {
    assert(typeof (config) == "object", "Config must be a JSON object");
    this.id = sanitize.nonemptystring(config.id) as any;
    this.pID = sanitize.string(config.pID, null);
    this.realname = sanitize.label(config.realname);
    this.setEMailAddress(config.emailAddress);
    this.replyTo = sanitize.emailAddress(config.replyTo, null);
    this.organisation = sanitize.label(config.organisation, null);
    this.signatureHTML = sanitize.string(config.signatureHTML, null);
    this.sendCC.clear();
    this.sendBCC.clear();
    this.sendCC.addAll(sanitize.array(config.sendCC).filter(e =>
      !!sanitize.emailAddress(e, null)));
    this.sendBCC.addAll(sanitize.array(config.sendBCC).filter(e =>
      !!sanitize.emailAddress(e, null)));
    this.smlAccount = SMLHTTPAccount.fromJSON(sanitize.json(config.smlAccount, null), this);
    this.encryptionPrivateKeys.clear();
    for (let keyJSON of sanitize.array(config.encryptionPrivateKeys, [])) {
      try {
        let key = privateKeyFromJSON(sanitize.json(keyJSON, null));
        this.encryptionPrivateKeys.add(key);
      } catch (ex) {
        this.account.errorCallback(ex);
      }
    }
  }
  toConfigJSON(): any {
    return {
      id: this.id,
      pID: this.pID,
      realname: this.realname,
      emailAddress: this.emailAddress,
      replyTo: this.replyTo,
      organisation: this.organisation,
      signatureHTML: this.signatureHTML,
      sendCC: this.sendCC.contents,
      sendBCC: this.sendBCC.contents,
      smlAccount: this.smlAccount?.toJSON(),
      encryptionPrivateKeys: this.encryptionPrivateKeys.contents.map(key => key.toJSON()),
    };
  }

  /**
   * Finds our user's identity which matches one of the the passed-in email addresses
   * @param addresses If any identity matches one of these emailAddresses,
   * select that identity by default.
   * In decreasing order of preference.
   */
  static findIdentity(addresses: Collection<PersonUID>, defaultAccount: MailAccount): { identity: MailIdentity, personUID: PersonUID } | null {
    let identities = appGlobal.emailAccounts.contents.map(acc => acc.identities.contents).flat();
    // console.log(`Checking ${addresses.join(", ")} for matches with identities ${identities.map(i => i.emailAddress).join(", ")}`);
    for (let candidate of addresses) {
      for (let identity of identities) {
        // console.log(`Checking whether ${candidate} matches identity ${identity.emailAddress} of account ${identity.account.name}`);
        if (identity.isEMailAddress(candidate.emailAddress)) {
          // console.log(`MATCH: ${candidate} matches identity ${identity.emailAddress} of account ${identity.account.name}`);
          let personUID = new PersonUID(candidate.emailAddress, identity.realname);
          return { identity, personUID };
        }
      }
    }
    let identity = defaultAccount.identities.first;
    // console.log("None match, choosing default account", defaultAccount.name, "identity", identity.emailAddress);
    return { identity, personUID: identity.asPersonUID() };
  }
}

export function findIdentityForEMailAddress(emailAddress: string): MailIdentity | null {
  if (!emailAddress) {
    return null;
  }
  for (let account of appGlobal.emailAccounts) {
    for (let identity of account.identities) {
      if (identity.isEMailAddress(emailAddress)) {
        return identity;
      }
    }
  }
  return null;
}

export function findAllIdentities(): ArrayColl<MailIdentity> {
  let identities = new ArrayColl<MailIdentity>();
  for (let account of appGlobal.emailAccounts) {
    identities.addAll(account.identities);
  }
  return identities;
}
