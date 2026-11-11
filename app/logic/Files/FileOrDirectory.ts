import type { Directory } from "./Directory";
import type { Tag, TaggableObject } from "../Abstract/Tag";
import { Observable, notifyChangedProperty } from "../util/Observable";
import { AbstractFunction, NotImplemented, assert } from "../util/util";
import { ArrayColl, SetColl } from "svelte-collections";

export class FileOrDirectory extends Observable implements TaggableObject {
  /** Primary key in the local SQL cache. null = not yet saved. */
  dbID: number | null = null;
  /** Full file path and name.
   * For directories, this must end with `/`. */
  @notifyChangedProperty
  path: string;
  /** Full path to the local file on user's disk. May be null */
  @notifyChangedProperty
  filepathLocal: string | null = null;
  /** Excluding directory path. For files, including file ext. */
  @notifyChangedProperty
  name: string;
  @notifyChangedProperty
  parent: Directory;
  @notifyChangedProperty
  lastMod = new Date();
  readonly tags = new SetColl<Tag>();
  syncState: string | number | null = null;

  get id() {
    return this.path;
  }
  set id(id: string) {
    this.path = id;
  }

  /** From the account root down to the directory that contains this */
  get parentDirs(): ArrayColl<Directory> {
    let dirs: Directory[] = [];
    for (let dir = this.parent; dir && !dirs.includes(dir); dir = dir.parent) {
      dirs.unshift(dir);
    }
    return new ArrayColl(dirs);
  }

  async save() {
    await this.saveLocally();
    await this.saveOnServer();
  }
  async saveLocally() {
    throw new AbstractFunction();
  }
  async saveOnServer() {
  }

  canDelete: boolean;
  async deleteIt() {
    await this.deleteLocally();
    await this.deleteOnServer();
  }
  async deleteLocally() {
    throw new AbstractFunction();
  }
  async deleteOnServer() {
  }

  async addTag(tag: Tag) {
  }

  async removeTag(tag: Tag) {
  }

  /** Creates a read-only URL that allows anybody to read the document */
  async shareLink(): Promise<string> {
    throw new NotImplemented();
  }
}
