import type { PersonUID } from "../../../logic/Abstract/PersonUID";
import { queryPGPKeyServersForUID } from "../../../logic/Mail/Encryption/PGP/KeyServer";
import type { Collection } from "svelte-collections";

// <copied from="../../../frontend/Mail/Composer/EncryptionDetails.svelte">
export async function queryKeyServers(recipients: Collection<PersonUID>, onlyNew = false) {
  let toQuery = onlyNew ? recipients.filterOnce(recipient => !(recipient as any)._queriedKeyserver) : recipients;
  if (toQuery.isEmpty) {
    return;
  }
  toQuery.forEach(recipient => (recipient as any)._queriedKeyserver = true);
  await Promise.all(toQuery.contents.map(recipient =>
    queryPGPKeyServersForUID(recipient)));
}
// </copied>
