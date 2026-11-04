import { ExchangeGAL } from "./ExchangeGAL";
import { EWSPerson } from "./EWSPerson";
import type { EWSAccount } from "../../Mail/EWS/EWSAccount";
import type { PublicKey } from "../../Mail/Encryption/PublicKey";
import { readDirectoryCertificates } from "../../Mail/Encryption/SMIME/SMIMEDirectory";
import { ensureArray, NotReached } from "../../util/util";
import { ArrayColl, type Collection } from "svelte-collections";

export class EWSGAL extends ExchangeGAL {
  readonly protocol: string = "gal-ews";
  account: EWSAccount;

  constructor(account: EWSAccount) {
    super();
    this.mainAccount = this.account = account;
    this.errorCallback = account.errorCallback;
  }

  newPerson(): EWSPerson {
    return new EWSPerson(this);
  }
  newGroup(): never {
    throw new NotReached();
  }

  protected async searchGAL(searchTerm: string): Promise<ArrayColl<EWSPerson>> {
    let query = {
      m$ResolveNames: {
        m$UnresolvedEntry: searchTerm,
        ReturnFullContactData: true,
      },
    };
    let persons = new ArrayColl<EWSPerson>();
    try {
      let response = await this.account.callEWS(query);
      for (let resolution of ensureArray(response.ResolutionSet?.Resolution)) {
        if (!resolution.Contact) {
          continue;
        }
        resolution.Contact.EmailAddresses = { Entry: convertEmailAddresses(ensureArray(resolution.Contact.EmailAddresses?.Entry), resolution.Mailbox) };
        let person = this.newPerson();
        person.fromXML(resolution.Contact);
        persons.add(person);
      }
    } catch (ex) {
      // This error is expected.
      if (ex.type != "ErrorNameResolutionNoResults") {
        throw ex;
      }
    }
    return persons;
  }

  /** The search uses the default property set, which has no certificates */
  protected async requestEncryptionKeys(emailAddress: string): Promise<Collection<PublicKey>> {
    let query = {
      m$ResolveNames: {
        m$UnresolvedEntry: "smtp:" + emailAddress,
        ReturnFullContactData: true,
        ContactDataShape: "AllProperties",
      },
    };
    try {
      let response = await this.account.callEWS(query);
      let resolution = ensureArray(response.ResolutionSet?.Resolution).find(candidate =>
        candidate.Mailbox?.EmailAddress?.toLowerCase() == emailAddress.toLowerCase());
      // `UserSMIMECertificate` and `MSExchangeCertificate` are the AD
      // attributes `userSMIMECertificate` and `userCertificate`, resp.
      return await readDirectoryCertificates(
        ensureArray(resolution?.Contact?.UserSMIMECertificate?.Base64Binary),
        ensureArray(resolution?.Contact?.MSExchangeCertificate?.Base64Binary),
        this.errorCallback);
    } catch (ex) {
      if (ex.type != "ErrorNameResolutionNoResults") { // this error is expected
        this.errorCallback(ex);
      }
      return new ArrayColl<PublicKey>();
    }
  }
}

interface EWSAddressEntry {
  Name: string;
  RoutingType :string;
  Value: string;
}

interface EWSMailbox {
  Name: string;
  EmailAddress: string;
  RoutingType: string;
}

function convertEmailAddresses(addresses: EWSAddressEntry[], mailbox?: EWSMailbox): EWSAddressEntry[] {
  for (let address of addresses) {
    // For some reason, GAL results don't separate out the routing type.
    if (/^(\w+):/.test(address.Value)) {
      address.RoutingType = RegExp.$1;
      address.Value = RegExp.rightContext;
    }
    if (mailbox && address.RoutingType == mailbox.RoutingType && address.Value == mailbox.EmailAddress) {
      mailbox = undefined;
    }
  }
  if (mailbox) {
    addresses.unshift({ Name: mailbox.Name, RoutingType: mailbox.RoutingType, Value: mailbox.EmailAddress });
  }
  return addresses;
}
