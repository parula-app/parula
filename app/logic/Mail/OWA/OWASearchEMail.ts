import { ExchangeSearchEMail } from "../EWS/ExchangeSearchEMail";
import { type OWAAccount, kMaxFetchCount } from "./OWAAccount";
import type { OWAFolder } from "./OWAFolder";
import { owaSearchMsgsRequest } from "./Request/OWAFolderRequests";
import { OWAError } from "./OWAError";
import type { EMail } from "../EMail";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { ArrayColl } from "svelte-collections";

/** Sends the search @see `ExchangeSearchEMail` as OWA `FindItem`. */
export class OWASearchEMail extends ExchangeSearchEMail {
  declare account: OWAAccount;

  async startSearch(limit?: number): Promise<ArrayColl<EMail>> {
    let results = new ArrayColl<EMail>();
    let conditions = this.conditions();
    if (!conditions) {
      return results;
    }
    let folders = (this.folder ? [this.folder] : this.account.getAllFolders().contents) as OWAFolder[];
    let result = await this.account.callOWA(owaSearchMsgsRequest(
      folders.map(folder => folder.id), conditions, limit ?? kMaxFetchCount));
    let items: any[] = [];
    // `callOWA()` unwraps only a single response, but we get 1 per folder
    for (let response of result.ResponseMessages?.Items ?? [result]) {
      if (response.ResponseClass == "Error") {
        throw new OWAError({ json: response });
      }
      items = items.concat(response.RootFolder?.Items ?? []);
    }
    items = this.newestFirst(items, limit);

    for (let folder of folders) {
      let newItemIDs: string[] = [];
      for (let item of items) {
        if (item.ParentFolderId?.Id != folder.id) {
          continue;
        }
        let itemID = sanitize.nonemptystring(item.ItemId.Id);
        if (folder.deletions.has(itemID)) {
          continue;
        }
        let email = folder.getEmailByItemID(itemID);
        if (email) {
          results.add(email);
        } else {
          newItemIDs.push(itemID);
        }
      }
      results.addAll(await folder.getNewMessageHeaders(newItemIDs));
    }
    return results;
  }
}
