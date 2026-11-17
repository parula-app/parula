import { Folder, SpecialFolder } from "../Folder";
import type { SearchEMail } from "../Store/SearchEMail";
import { newSearchEMail } from "../Store/setStorage";
import type { AllAccounts } from "./AllAccounts";
import type { EMail } from "../EMail";
import { allAccountsAccount } from "../AccountsList/ShowAccounts";
import { dataError } from "../../util/error";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { assert, NotReached } from "../../util/util";
import { Collection, ArrayColl } from "svelte-collections";

export class SavedSearchFolder extends Folder {
  account: AllAccounts;
  _foldersDummy = new ArrayColl<Folder>();
  search: SearchEMail;
  readonly specialFolder: SpecialFolder = SpecialFolder.Search;

  constructor(search: SearchEMail) {
    super(allAccountsAccount);
    this.search = search;
    this.id = crypto.randomUUID();
  }

  get folders(): Collection<Folder> {
    return this._foldersDummy;
  }
  set folders(val: Collection<Folder>) {
    throw new NotReached();
  }

  async listMessages(): Promise<Collection<EMail>> {
    let messages = await this.search.startSearch();
    this.messages.clear();
    this.messages.addAll(messages);
    this.countTotal = this.messages.length;
    return messages;
  }

  async downloadMessages(emails: Collection<EMail>): Promise<Collection<EMail>> {
    return new ArrayColl<EMail>();
    /* Uses .Display connection.
      Also, search creates new emails, so it always downloads all, every time.
    await Promise.all(emails.contents.map(email =>
      email.download()));
    return emails;*/
  }

  async downloadAllMessages(): Promise<Collection<EMail>> {
    return new ArrayColl<EMail>();
  }

  static readFromJSON(json: any): SavedSearchFolder {
    let search = newSearchEMail();
    search.fromJSON(json);
    let folder = new SavedSearchFolder(search);
    folder.name = sanitize.label(json.name, "Search");
    return folder;
  }

  toJSON() {
    let json: any = this.search.toJSON();
    json.name = this.name;
    return json;
  }

  newEMail(): EMail {
    let account = this.account.accounts.first;
    assert(account, "Setup and select email account first");
    let folder = account.getSpecialFolder(SpecialFolder.Sent);
    assert(folder, `No folder found in account ${account.name}`);
    return folder.newEMail();
  }

  async save() {
    if (!savedSearchFolders.contains(this)) {
      savedSearchFolders.add(this);
    }
    saveSavedSearches();
  }

  async deleteIt() {
    let disableDelete = this.disableDelete();
    assert(!disableDelete, disableDelete || "Cannot delete");
    savedSearchFolders.remove(this);
    saveSavedSearches();
  }

  disableDelete(): string | false {
    return false;
  }
  disableSubfolders(): string | false {
    return "This folder is a search";
  }
  disableChangeSpecial(): string | false {
    return "This is a search folder. You cannot change its type, but you may delete it.";
  }

  async moveMessagesHere(messages: Collection<EMail>) {
    throw new Error(`${this.name} is a saved search. You cannot move messages here.`);
  }
  async copyMessagesHere(messages: Collection<EMail>) {
    throw new Error(`${this.name} is a saved search. You cannot copy messages here.`);
  }
  async moveFolderHere(folder: Folder) {
    throw new Error(`${this.name} is a saved search. You cannot move folders here.`);
  }
  async createSubFolder(name: string): Promise<Folder> {
    throw new Error(`${this.name} is a saved search. You cannot create subfolders.`);
  }
}

export const savedSearchFolders = new ArrayColl<SavedSearchFolder>();

/** Called on startup only.
 * Populates `savedSearchFolders` and saves to localStorage. */
export function readSavedSearches() {
  try {
    assert(savedSearchFolders.isEmpty, "Already read saved searches. Call this only once at startup");
    let arrayJSON = sanitize.array(JSON.parse(sanitize.nonemptystring(localStorage.getItem("savedSearches"), null)), []);
    for (let searchJSON of arrayJSON) {
      try {
        savedSearchFolders.add(SavedSearchFolder.readFromJSON(searchJSON));
      } catch (ex) {
        dataError(ex);
      }
    }
  } catch (ex) {
    dataError(ex);
  }
  allAccountsAccount.rootFolders.addColl(savedSearchFolders);
}

/** Called whenever saved searches have been modified.
 * Saves to localStorage. */
export function saveSavedSearches() {
  let arrayJSON = savedSearchFolders.contents.map(folder => folder.toJSON());
  localStorage.setItem("savedSearches", JSON.stringify(arrayJSON, null, 2));
}
