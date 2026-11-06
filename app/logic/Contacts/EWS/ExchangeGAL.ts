import { SearchOnlyAddressbook } from "../Addressbook";
import type { Person } from "../../Abstract/Person";
import type { MailAccount } from "../../Mail/MailAccount";
import type { PublicKey } from "../../Mail/Encryption/PublicKey";
import { usesCrypto } from "../../Mail/Encryption/KeyUtils";
import { SMIMEPrivateKey } from "../../Mail/Encryption/SMIME/SMIMEPrivateKey";
import { KeyStatus, SMIMEPublicKey } from "../../Mail/Encryption/SMIME/SMIMEPublicKey";
import { getBaseDomainFromHost, getDomainForEmailAddress } from "../../util/netUtil";
import { logErrorToServer } from "../../util/error";
import { AbstractFunction } from "../../util/util";
import { ArrayColl, type Collection } from "svelte-collections";

/** The Global Address List (GAL) of an Exchange server */
export class ExchangeGAL extends SearchOnlyAddressbook {
  account: MailAccount;

  /** Exchange matches the start of first name, last name, display name,
   * alias and office, but not reliably the email addresses.
   * With an `smtp:` prefix, it matches the start of all email addresses instead.
   * No Exchange API searches both in one call.
   * Adds the results of each search as soon as it returns,
   * because the other search may be slow.
   * Logs errors, does not throw. */
  async quickSearchAsync(searchTerm: string, results: ArrayColl<Person>) {
    await Promise.all([ // Exchange can't search for both in a single server call :-(
      searchTerm, // name
      "smtp:" + searchTerm, // email address
    ].map(async term => {
      try {
        let persons = await this.searchGAL(term);
        for (let person of persons) {
          // Dedup
          if (results.find(existing => existing.name == person.name &&
              existing.emailAddresses.first?.value == person.emailAddresses.first?.value)) {
            continue;
          }
          results.add(person);
        }
      } catch (ex) {
        logErrorToServer(ex);
      }
    }));
  }

  /** @returns the persons whose fields start with `searchTerm`,
   *   without their S/MIME certificates */
  protected async searchGAL(searchTerm: string): Promise<ArrayColl<Person>> {
    throw new AbstractFunction();
  }

  /** By lowercase email address */
  protected readonly encryptionKeyLookups = new Map<string, Promise<Collection<PublicKey>>>();

  /** Asks only about the first email address which has the same base domain
   * as one of our identities, if that identity has an S/MIME certificate itself.
   * Only then we may find one here, and need it.
   * Costs a server round trip only once per email address. */
  async fetchEncryptionKeys(emailAddresses: Collection<string>): Promise<Collection<PublicKey>> {
    let emailAddress = emailAddresses.find(emailAddress => {
      let domain = getBaseDomainFromHost(getDomainForEmailAddress(emailAddress));
      return this.account.identities.some(
             identity => usesCrypto(identity, SMIMEPrivateKey) &&
             getBaseDomainFromHost(getDomainForEmailAddress(identity.emailAddress)) == domain);
    })?.toLowerCase();
    if (!emailAddress) {
      return new ArrayColl<PublicKey>();
    }
    let lookup = this.encryptionKeyLookups.get(emailAddress);
    if (!lookup) {
      lookup = this.requestTrustedEncryptionKeys(emailAddress);
      this.encryptionKeyLookups.set(emailAddress, lookup);
    }
    return await lookup;
  }

  /** The server could hand out a certificate of its own, so we take only those that a trusted CA issued */
  protected async requestTrustedEncryptionKeys(emailAddress: string): Promise<Collection<PublicKey>> {
    let trusted = new ArrayColl<PublicKey>();
    for (let key of await this.requestEncryptionKeys(emailAddress)) {
      try {
        if (key instanceof SMIMEPublicKey && await key.keyStatus() == KeyStatus.Valid) {
          trusted.add(key);
        }
      } catch (ex) {
        this.errorCallback(ex);
      }
    }
    return trusted;
  }

  /** The GAL search leaves out the S/MIME certificates,
   * so we resolve the person once more, which returns them.
   * Reports errors, does not throw. */
  protected async requestEncryptionKeys(emailAddress: string): Promise<Collection<PublicKey>> {
    throw new AbstractFunction();
  }
}
