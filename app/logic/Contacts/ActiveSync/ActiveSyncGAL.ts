import { ExchangeGAL } from "../EWS/ExchangeGAL";
import { ActiveSyncPerson } from "./ActiveSyncPerson";
import type { ActiveSyncAccount } from "../../Mail/ActiveSync/ActiveSyncAccount";
import { ActiveSyncError } from "../../Mail/ActiveSync/ActiveSyncError";
import type { PublicKey } from "../../Mail/Encryption/PublicKey";
import { readCertificates } from "../../Mail/Encryption/SMIME/SMIMEDirectory";
import { ensureArray, NotReached } from "../../util/util";
import { ArrayColl, type Collection } from "svelte-collections";

export class ActiveSyncGAL extends ExchangeGAL {
  readonly protocol: string = "gal-activesync";
  account: ActiveSyncAccount;

  constructor(account: ActiveSyncAccount) {
    super();
    this.mainAccount = this.account = account;
    this.errorCallback = account.errorCallback;
  }

  newPerson(): ActiveSyncPerson {
    return new ActiveSyncPerson(this);
  }
  newGroup(): never {
    throw new NotReached();
  }

  protected async searchGAL(searchTerm: string): Promise<ArrayColl<ActiveSyncPerson>> {
    let query = {
      Store: {
        Name: "GAL",
        Query: searchTerm,
      },
    };
    let response = await this.account.callEAS("Search", query);
    if (response.Response.Store.Status != "1") {
      throw new ActiveSyncError("Search", response.Response.Store.Status, this.account);
    }
    let persons = new ArrayColl<ActiveSyncPerson>();
    for (let result of ensureArray(response.Response.Store.Result)) {
      let properties = result.Properties;
      // Convert from GAL format to contact format
      properties.Email1Address = properties.EmailAddress;
      properties.BusinessPhoneNumber = result.Properties.Phone;
      properties.HomePhoneNumber = result.Properties.HomePhone;
      properties.MobilePhoneNumber = result.Properties.MobilePhone;
      properties.CompanyName = properties.Company;
      let person = this.newPerson();
      person.fromWBXML(properties);
      persons.add(person);
    }
    return persons;
  }

  /** The GAL search returns no S/MIME certificates */
  protected async requestEncryptionKeys(emailAddress: string): Promise<Collection<PublicKey>> {
    // Maximum number of certificates, and of matches for the email address, that the server should return
    const kMaxCertificateResults = 10;
    let query = {
      To: emailAddress,
      Options: {
        CertificateRetrieval: "2", // the full certificate, not the obsolete mini certificate
        MaxCertificates: String(kMaxCertificateResults),
        MaxAmbiguousRecipients: String(kMaxCertificateResults),
      },
    };
    try {
      let response = await this.account.callEAS("ResolveRecipients", query);
      if (response.Status != "1") {
        throw new ActiveSyncError("ResolveRecipients", response.Status, this);
      }
      let recipient = ensureArray(response.Response?.Recipient).find(candidate =>
        candidate.EmailAddress?.toLowerCase() == emailAddress.toLowerCase());
      // Status 1 means that we got the certificates of this recipient
      if (recipient?.Certificates?.Status == "1") {
        return await readCertificates(ensureArray(recipient.Certificates.Certificate), this.errorCallback);
      }
    } catch (ex) {
      this.errorCallback(ex);
    }
    return new ArrayColl<PublicKey>();
  }
}
