import { FileOrDirectory } from "./FileOrDirectory";
import { File } from "./File";
import type { Person } from "../Abstract/Person";
import type { FileSharingAccount } from "./FileSharingAccount";
import { AbstractFunction, assert } from "../util/util";
import { ArrayColl, Collection } from "svelte-collections";

export class Directory extends FileOrDirectory {
  readonly files = new ArrayColl<File>();
  readonly subDirs = new ArrayColl<Directory>();
  account: FileSharingAccount;
  sentToFrom: Person;

  get children(): Collection<Directory> {
    return this.subDirs;
  }

  newDirectory(name: string, dir = new Directory()): Directory {
    dir.name = name;
    dir.account = this.account;
    dir.parent = this;
    dir.path = this.childPath(dir.name, true);
    return dir;
  }

  newFile(name: string, file = new File()): File {
    file.setFileName(name);
    file.parent = this;
    file.path = this.childPath(file.name);
    return file;
  }

  async listContents() {
  }

  async uploadChangedFiles() {
    for (let file of this.files) {
      try {
        await file.uploadIfChanged();
      } catch (ex) {
        this.account.errorCallback(ex);
      }
    }
    this.list
  }

  async moveFileHere(file: File) {
    await this.moveFilesHere(new ArrayColl([file]));
  }

  async copyFileHere(file: File) {
    await this.copyFilesHere(new ArrayColl([file]));
  }

  /**
   * To move files into this directory, call this on the target directory.
   * All `files` must share the same source directory.
   */
  async moveFilesHere(files: Collection<File>) {
    await this.moveOrCopyFilesHere("move", files);
  }

  /**
   * To copy files into this directory, call this on the target directory.
   * All `files` must share the same source directory.
   */
  async copyFilesHere(files: Collection<File>) {
    await this.moveOrCopyFilesHere("copy", files);
  }

  /**
   * Helper for `moveFilesHere()` and `copyFilesHere()`. Decides between
   * cross-account download+upload+delete and same-account server-side action,
   * then calls `moveOrCopyFilesOnServer()` for the latter.
   *
   * @param sameAccount
   *   true = source and target are on the same server; subclass moves/copies on the server.
   *   false = upload to target, delete on source.
   *   default: true if `this.account` matches the source's account.
   *   Override to true for delegate/dependent accounts that share a server.
   */
  protected async moveOrCopyFilesHere(action: "move" | "copy", files: Collection<File>, sameAccount?: boolean) {
    let sourceFolder = files.first.parent;
    assert(sourceFolder, "Need source folder");
    assert(files.contents.every(file => file.parent === sourceFolder), "All files must be from the same folder");
    sameAccount ??= this.account == sourceFolder.account;

    if (action == "move") {
      sourceFolder.files.removeAll(files);
    }
    if (!sameAccount) {
      for (let file of files) {
        await file.download();
        await this.addFile(file);
        if (action == "move") {
          await file.deleteIt();
        }
      }
      return;
    }
    await this.moveOrCopyFilesOnServer(action, files);
  }

  /** Subclasses implement the server-side move/copy. Source and target are on the same account. */
  protected async moveOrCopyFilesOnServer(action: "move" | "copy", files: Collection<File>) {
    throw new AbstractFunction();
  }

  async addFile(file: File) {
    await file.download();
    throw new AbstractFunction();
  }

  async createSubDirectory(name: string): Promise<Directory> {
    let subDir = this.newDirectory(name);
    this.subDirs.add(subDir);
    throw new AbstractFunction();
  }

  async saveLocally() {
    await this.account.storage?.saveDirectory(this);
  }

  async deleteLocally(): Promise<void> {
    this.parent?.subDirs.remove(this);
    await this.account.storage?.deleteDirectory(this);
  }

  /** The `json` column of the DB row, for properties without a column of their own */
  toExtraJSON(): any {
    return {};
  }
  fromExtraJSON(json: any) {
  }

  /** Root-relative path of a child file of this directory. */
  childPath(name: string, directory = false): string {
    return this.path + name + (directory ? "/" : "");
  }
}
