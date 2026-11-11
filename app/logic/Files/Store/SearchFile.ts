import type { File } from "../File";
import { Directory } from "../Directory";
import type { FileOrDirectory } from "../FileOrDirectory";
import type { FileSharingAccount } from "../FileSharingAccount";
import { fileExtensions } from "../FileType/MIMETypes";
import { getTagByName, type Tag } from "../../Abstract/Tag";
import { appGlobal } from "../../app";
import { dataError } from "../../util/error";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { notifyChangedProperty, Observable } from "../../util/Observable";
import { ArrayColl, SetColl, type Collection } from "svelte-collections";

/** Contains the search criteria for files and folders,
 * and searches the files and folders that we already listed.
 * Criteria which are null are ignored in the search.
 * You fill out only the criteria fields that you want to search for. */
export class SearchFile extends Observable {
  @notifyChangedProperty
  account: FileSharingAccount | null = null;
  /** Searches in this directory and its subdirectories */
  @notifyChangedProperty
  directory: Directory | null = null;

  @notifyChangedProperty
  sentDateMin: Date | null = null;
  @notifyChangedProperty
  sentDateMax: Date | null = null;
  @notifyChangedProperty
  sizeMin: number | null = null;
  @notifyChangedProperty
  sizeMax: number | null = null;

  @notifyChangedProperty
  isReplied: boolean | null = null;
  readonly tags = new SetColl<Tag>();

  @notifyChangedProperty
  hasMIMETypesOn: boolean | null = null;
  /** Is a file of one of these types.
   * A type that ends with "/" matches all its subtypes. */
  readonly hasMIMETypes = new SetColl<string>;

  /** Searches the file and folder names, and the text of the documents
   * whose contents we already have, @see `File.localText()` */
  @notifyChangedProperty
  contentText: string | null = null;

  /** Resolves once the search in the file contents finished. `startSearch()` returns
   * before that, and keeps adding to the collection that it returned. */
  finished: Promise<void> = Promise.resolve();
  protected stopContentSearch: AbortController | null = null;

  async startSearch(limit = Infinity): Promise<ArrayColl<FileOrDirectory>> {
    this.stopContentSearch?.abort();
    let stop = this.stopContentSearch = new AbortController();
    let found = new ArrayColl<FileOrDirectory>();
    let byContent = new ArrayColl<File>();
    if (this.directory) {
      this.findIn(this.directory.subDirs, this.directory.files, found, byContent, limit);
    } else {
      let accounts = this.account ? new ArrayColl([this.account]) : appGlobal.fileSharingAccounts;
      for (let account of accounts) {
        this.findIn(account.rootDirs, new ArrayColl<File>(), found, byContent, limit);
      }
    }
    this.finished = this.findInContents(byContent, found, limit, stop.signal);
    return found;
  }

  protected findIn(dirs: Collection<Directory>, files: Collection<File>, found: ArrayColl<FileOrDirectory>, byContent: ArrayColl<File>, limit: number) {
    for (let dir of dirs) {
      if (found.length >= limit) {
        return;
      }
      if (this.matches(dir)) {
        found.add(dir);
      }
      this.findIn(dir.subDirs, dir.files, found, byContent, limit);
    }
    for (let file of files) {
      if (found.length >= limit) {
        return;
      }
      if (!this.matchesProperties(file)) {
        continue;
      }
      if (this.matchesTerms(file)) {
        found.add(file);
      } else {
        byContent.add(file);
      }
    }
  }

  protected async findInContents(files: Collection<File>, found: ArrayColl<FileOrDirectory>, limit: number, stop: AbortSignal) {
    const kMaxDocuments = 1000;
    let searched = 0;
    for (let file of files) {
      if (stop.aborted || found.length >= limit || searched >= kMaxDocuments) {
        return;
      }
      try {
        let text = await file.localText();
        if (text == null) {
          continue;
        }
        searched++;
        if (this.matchesTerms(file, text)) {
          found.add(file);
        }
      } catch (ex) {
        dataError(ex);
      }
    }
  }

  fromJSON(json: any) {
    function boolean(value: boolean | null): boolean | null {
      return typeof (value) == "boolean" ? value : null;
    }
    this.contentText = sanitize.string(json.bodyText, null) ?? null;
    this.isReplied = boolean(json.isReplied);
    this.hasMIMETypesOn = boolean(json.hasAttachment);
    this.hasMIMETypes.replaceAll(sanitize.array(
      json.hasMIMETypes?.map(mimetype => sanitize.string(mimetype)), []));
    this.sizeMin = sanitize.integer(json.sizeMin, null) ?? null;
    this.sizeMax = sanitize.integer(json.sizeMax, null) ?? null;
    this.sentDateMin = sanitize.date(json.sentDateMin, null) ?? null;
    this.sentDateMax = sanitize.date(json.sentDateMax, null) ?? null;

    this.account = appGlobal.fileSharingAccounts.find(acc => acc.id == json.accountID);
    this.directory = this.account?.findFolder(folder => folder.id == json.folderID) ?? null;
    this.tags.replaceAll(sanitize.array(json.tags, [])?.map(name => getTagByName(name)));
  }

  toJSON() {
    return {
      bodyText: this.contentText,
      isReplied: this.isReplied,
      hasAttachment: this.hasMIMETypesOn,
      hasAttachmentMIMETypes: this.hasMIMETypes.contents,
      sizeMin: this.sizeMin,
      sizeMax: this.sizeMax,
      sentDateMin: this.sentDateMin?.toISOString(),
      sentDateMax: this.sentDateMax?.toISOString(),
      accountID: this.account?.id ?? this.directory?.account?.id,
      folderID: this.directory?.id,
      tags: this.tags?.contents.map(tag => tag.name),
    };
  }

  clone(): SearchFile {
    let clone = new (this as any).constructor();
    clone.fromJSON(this.toJSON());
    return clone;
  }

  /** Whether `entry` matches the criteria, apart from `account` and `directory` */
  matches(entry: FileOrDirectory): boolean {
    return this.matchesTerms(entry) && this.matchesProperties(entry);
  }

  protected matchesTerms(entry: FileOrDirectory, text?: string): boolean {
    let name = entry.name?.toLowerCase() ?? "";
    text = text?.toLowerCase();
    return this.searchTerms.every(term => name.includes(term) || text?.includes(term));
  }

  protected get searchTerms(): string[] {
    return this.contentText?.toLowerCase().split(" ").filter(Boolean) ?? [];
  }

  protected matchesProperties(entry: FileOrDirectory): boolean {
    for (let tag of this.tags) {
      if (!entry.tags.has(tag)) {
        return false;
      }
    }
    if (entry instanceof Directory) {
      return !this.hasMIMETypes.hasItems && !this.sizeMin && !this.sizeMax;
    }
    let file = entry as File;
    if (this.hasMIMETypes.hasItems &&
        !this.isOneOfMIMETypes(file.mimetype) &&
        !this.isOneOfMIMETypes(fileExtensions[file.ext?.toLowerCase()])) {
      return false;
    }
    if (this.sizeMin && !(this.sizeMin <= file.size)) {
      return false;
    }
    if (this.sizeMax && !(this.sizeMax >= file.size)) {
      return false;
    }
    return true;
  }

  protected isOneOfMIMETypes(mimetype: string | undefined): boolean {
    return !!mimetype && !!this.hasMIMETypes.find(type =>
      type.endsWith("/") ? mimetype.startsWith(type) : mimetype == type);
  }
}
