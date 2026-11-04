import { ExchangeGAL } from "../EWS/ExchangeGAL";
import { OWAPerson } from "./OWAPerson";
import type { OWAAccount } from "../../Mail/OWA/OWAAccount";
import type { PublicKey } from "../../Mail/Encryption/PublicKey";
import { owaFindGALPersonsRequest, owaResolveNamesRequest } from "./Request/OWAPersonRequests";
import { readDirectoryCertificates } from "../../Mail/Encryption/SMIME/SMIMEDirectory";
import { ensureArray, NotReached } from "../../util/util";
import { ArrayColl, type Collection } from "svelte-collections";

export class OWAGAL extends ExchangeGAL {
  readonly protocol: string = "gal-owa";
  account: OWAAccount;

  constructor(account: OWAAccount) {
    super();
    this.mainAccount = this.account = account;
    this.errorCallback = account.errorCallback;
  }

  newPerson(): OWAPerson {
    return new OWAPerson(this);
  }
  newGroup(): never {
    throw new NotReached();
  }

  protected async searchGAL(searchTerm: string): Promise<ArrayColl<OWAPerson>> {
    let response = await this.account.callOWA(owaFindGALPersonsRequest(searchTerm));
    let persons = new ArrayColl<OWAPerson>();
    for (let result of response.ResultSet) {
      let person = this.newPerson();
      person.fromJSON(result);
      persons.add(person);
    }
    return persons;
  }

  /** The personas that the GAL search returns have no S/MIME certificates */
  protected async requestEncryptionKeys(emailAddress: string): Promise<Collection<PublicKey>> {
    try {
      let response = await this.account.callOWA(owaResolveNamesRequest("smtp:" + emailAddress));
      let resolution = ensureArray(response.ResolutionSet).find(candidate =>
        candidate.Mailbox?.EmailAddress?.toLowerCase() == emailAddress.toLowerCase());
      // `UserSMIMECertificate` and `MSExchangeCertificate` are the AD
      // attributes `userSMIMECertificate` and `userCertificate`, resp.
      return await readDirectoryCertificates(
        ensureArray(resolution?.Contact?.UserSMIMECertificate),
        ensureArray(resolution?.Contact?.MSExchangeCertificate),
        this.errorCallback);
    } catch (ex) {
      if (ex.type != "ErrorNameResolutionNoResults") { // this error is expected
        this.errorCallback(ex);
      }
      return new ArrayColl<PublicKey>();
    }
  }
}
