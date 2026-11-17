import { SearchEMail } from "./SearchEMail";
import { QuickSearchEMail } from "./QuickSearchEMail";
// #if [!WEBMAIL]
import { SQLSearchEMail } from "../SQL/SQLSearchEMail";
// #endif
import type { EMail } from "../EMail";
import type { MailAccount } from "../MailAccount";
import { appGlobal } from "../../app";
import { minorError } from "../../util/error";
import { ArrayColl, Collection, SetColl } from "svelte-collections";

/** Runs the local database search and the server-side search of each account in
 * parallel, and combines their results. Each of them finds emails that the others
 * miss: the database knows only what we downloaded, each server only its own account. */
export class CombinedSearchEMail extends SearchEMail {
  /** Resolves once all the searches finished. `startSearch()` returns before that,
   * and keeps adding to the collection that it returned, as the results come in. */
  finished: Promise<any> = Promise.resolve();

  async startSearch(limit?: number): Promise<ArrayColl<EMail>> {
    let searches = new ArrayColl<SearchEMail>();
    let dbSearch: SearchEMail = null;
    // #if [!WEBMAIL]
    dbSearch = new SQLSearchEMail();
    dbSearch.copyFrom(this);
    searches.add(dbSearch);
    // #endif

    let emailAccounts = new ArrayColl(appGlobal.emailAccounts) as Collection<MailAccount>;
    let onlyAccount = this.account ?? this.folder?.account;
    if (onlyAccount) {
      emailAccounts = new ArrayColl([onlyAccount]);
    } else if (this.workspace) {
      emailAccounts = appGlobal.emailAccounts.filterOnce(acc => acc.workspace == this.workspace);
    }

    for (let account of emailAccounts) {
      let serverSearch = account.newSearch();
      if (!serverSearch) {
        continue;
      }
      serverSearch.copyFrom(this);
      serverSearch.account = account;
      searches.add(serverSearch);
    }

    let foundMap = new SetColl<string | EMail>();
    let allResults = new ArrayColl<EMail>();
    /** A search without a limit may read the whole database, but must not
     * download whole mailboxes, e.g. every email that has an attachment. */
    const kMaxServerResults = 200;
    let serverLimit = limit ?? kMaxServerResults;

    /** Drops the results that the server could not filter out */
    let resultFilter = new QuickSearchEMail();
    resultFilter.copyFrom(this);

    this.finished = Promise.all(searches.contents.map(async search => {
      try {
        let isDBSearch = search == dbSearch;
        let found = await search.startSearch(isDBSearch ? limit : serverLimit);
        addUnique(isDBSearch ? found : resultFilter.filter(found, true), allResults, foundMap, limit);
      } catch (ex) {
        minorError(ex); // The other searches should still return their results
      }
    }));

    return allResults.sortBy(email => -(email.sent?.getTime() ?? 0));
  }
}

/** De-duplicate. The same email is often found by several of the searches */
function addUnique(newResults: Collection<EMail>, allResults: Collection<EMail>, foundMap: SetColl<string | EMail>, limit: number) {
  for (let email of newResults) {
    // Without an ID, we cannot tell whether another search found it, too
    let id = email.pID ?? email.messageID;
    let key = id
      ? `${email.folder?.account?.id}\n${email.folder?.id}\n${id}`
      : email;
    if (foundMap.has(key)) {
      continue;
    }
    foundMap.add(key);
    allResults.add(email);
  }
  // A later search may find newer emails than those that came in first,
  // so drop the oldest ones only after adding them all
  if (limit && allResults.length > limit) {
    allResults.removeAll(allResults.contents
      .sort((a, b) => (b.sent?.getTime() ?? 0) - (a.sent?.getTime() ?? 0))
      .slice(limit));
  }
}
