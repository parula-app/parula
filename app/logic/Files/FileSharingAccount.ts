import { ArrayColl, Collection } from "svelte-collections";
import { Account } from "../Abstract/Account";
import { Directory } from "./Directory";
import type { File } from "./File";
import { appGlobal } from "../app";

export class FileSharingAccount extends Account {
  readonly protocol: string = "files";
  readonly rootDirs = new ArrayColl<Directory>;
  storage: FileStorage;

  newDirectory(name: string, dir = new Directory()): Directory {
    dir.name = name;
    dir.account = this;
    dir.parent = null;
    return dir;
  }

  async syncOnStartup() {
    await super.syncOnStartup();
    await this.sync();
  }

  async sync() {
  }

  async readFromDB() {
    if (this.rootDirs.isEmpty) {
      await this.storage?.readDirectoryHierarchy(this);
    }
  }

  async save(): Promise<void> {
    await super.save();
    await this.storage?.saveAccount(this);
  }

  async deleteIt(): Promise<void> {
    await this.storage?.deleteAccount(this);
    await super.deleteIt();
    appGlobal.fileSharingAccounts.remove(this);
  }
}

export interface FileStorage {
  saveAccount(account: FileSharingAccount): Promise<void>;
  deleteAccount(account: FileSharingAccount): Promise<void>;
  readDirectoryHierarchy(account: FileSharingAccount): Promise<void>;
  saveDirectory(directory: Directory): Promise<void>;
  deleteDirectory(directory: Directory): Promise<void>;
  readFile(file: File): Promise<void>;
  readFileContent(file: File): Promise<void>;
  saveFile(file: File): Promise<void>;
  saveFiles(files: Collection<File>): Promise<void>;
  saveFileTags(file: File): Promise<void>;
  deleteFile(file: File): Promise<void>;
  readAllFiles(directory: Directory, limit?: number, startWith?: number): Promise<ArrayColl<File>>;
}
