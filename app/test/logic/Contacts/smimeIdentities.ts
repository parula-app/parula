import { MailIdentity } from "../../../logic/Mail/MailIdentity";
import { SMIMEPrivateKey } from "../../../logic/Mail/Encryption/SMIME/SMIMEPrivateKey";
import { ArrayColl } from "svelte-collections";

/** Gives the account identities with an S/MIME certificate each.
 * The GAL asks for the certificates of others only in their domains. */
export function addSMIMEIdentities(account: any, ...emailAddresses: string[]) {
  account.identities = new ArrayColl(emailAddresses.map(emailAddress => {
    let identity = new MailIdentity(account);
    identity.emailAddress = emailAddress;
    let key = new SMIMEPrivateKey();
    key.id = "1234567890abcdef";
    key.obsolete = false;
    identity.encryptionPrivateKeys.add(key);
    return identity;
  }));
}
