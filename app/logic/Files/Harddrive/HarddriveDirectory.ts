import { Directory } from "../Directory";
import type { File } from "../File";
import { HarddriveFile } from "./HarddriveFile";
import type { HarddriveAccount } from "./HarddriveAccount";
import { fileExtensions } from "../FileType/MIMETypes";
import { appGlobal } from "../../app";
import { Lock } from "../../util/flow/Lock";
import { UserError } from "../../util/util";
import { gt } from "../../../l10n/l10n";
import type { ArrayColl, Collection } from "svelte-collections";

export class HarddriveDirectory extends Directory {
  declare account: HarddriveAccount;
  declare parent: HarddriveDirectory;
  readonly files: ArrayColl<HarddriveFile>;
  readonly subDirs: ArrayColl<HarddriveDirectory>;
  protected readonly listLock = new Lock();

  newDirectory(name: string): HarddriveDirectory {
    let dir = super.newDirectory(name, new HarddriveDirectory()) as HarddriveDirectory;
    dir.filepathLocal = dir.path;
    return dir;
  }

  newFile(name: string): HarddriveFile {
    let file = super.newFile(name, new HarddriveFile()) as HarddriveFile;
    file.filepathLocal = file.path;
    return file;
  }

  async listContents() {
    let lock = await this.listLock.lock();
    try {
      let entries = await appGlobal.remoteApp.listDirectoryContents(this.path, true, false);
      let vanishedFiles = new Map(this.files.contents.map(file => [file.path, file]));
      let vanishedDirs = new Map(this.subDirs.contents.map(dir => [dir.path, dir]));
      for (let entry of entries) {
        if (entry.isDirectory) {
          let path = this.childPath(entry.name, true);
          let dir = vanishedDirs.get(path);
          vanishedDirs.delete(path);
          if (!dir) {
            dir = this.newDirectory(entry.name);
            this.subDirs.add(dir);
          }
          dir.name = entry.name;
          dir.lastMod = entry.lastMod;
        } else {
          let path = this.childPath(entry.name);
          let file = vanishedFiles.get(path);
          vanishedFiles.delete(path);
          if (!file) {
            file = this.newFile(entry.name);
            this.files.add(file);
          }
          if (file.isDownloaded && (file.size != entry.size || file.lastMod.getTime() != entry.lastMod.getTime())) {
            await file.deleteLocalCache();
          }
          file.setFileName(entry.name);
          file.filepathLocal = entry.path;
          file.mimetype = fileExtensions[file.ext.toLowerCase()] ?? "";
          file.size = entry.size;
          file.lastMod = entry.lastMod;
        }
      }
      this.files.removeAll([...vanishedFiles.values()]);
      this.subDirs.removeAll([...vanishedDirs.values()]);
      for (let file of vanishedFiles.values()) {
        file.clearURL();
      }
    } finally {
      lock.release();
    }
  }

  async createSubDirectory(name: string): Promise<HarddriveDirectory> {
    this.checkChildName(name);
    let subDir = this.newDirectory(name);
    await this.account.checkFree(subDir.path);
    await appGlobal.remoteApp.fs.mkdir(subDir.path, { mode: 0o700 });
    await this.listContents();
    return this.subDirs.find(dir => dir.path == subDir.path) ?? subDir;
  }

  async addFile(file: File) {
    this.checkChildName(file.name);
    let path = this.childPath(file.name);
    await this.account.checkFree(path);
    await file.download();
    let contents = new Uint8Array(await file.contents.arrayBuffer());
    await appGlobal.remoteApp.fs.writeFile(path, contents, { flag: "wx", mode: 0o600 });
    await appGlobal.remoteApp.fs.utimes(path, new Date(), file.lastMod ?? new Date());
    await this.listContents();
  }

  protected async moveOrCopyFilesOnServer(action: "move" | "copy", files: Collection<File>) {
    let source = files.first.parent;
    try {
      for (let file of files) {
        let path = this.childPath(file.name);
        if (action == "move") {
          await this.account.move(file.path, path);
        } else {
          await this.account.copy(file.path, path);
        }
      }
    } finally {
      await this.listContents();
      if (source != this) {
        await source.listContents();
      }
    }
  }

  async renameOnServer(newName: string) {
    if (!this.parent) {
      return;
    }
    await this.parent.renameChild(this, newName);
  }

  /** Renames a file or folder of this folder on disk, and changes its path.
   * Its name is set by `rename()`, which calls this via `renameOnServer()`. */
  async renameChild(child: HarddriveFile | HarddriveDirectory, newName: string) {
    this.checkChildName(newName);
    let path = this.childPath(newName, child instanceof HarddriveDirectory);
    await this.account.move(child.path, path);
    child.setPath(path);
  }

  /** Also changes the paths of the contents, which contain our name */
  setPath(path: string) {
    this.path = this.filepathLocal = path;
    for (let file of this.files) {
      file.setPath(this.childPath(file.name));
    }
    for (let dir of this.subDirs) {
      dir.setPath(this.childPath(dir.name, true));
    }
  }

  async deleteIt() {
    if (this.account.rootDirs.find(root => root.path.startsWith(this.path))) {
      throw new UserError(gt`You cannot delete ${this.name}`);
    }
    await super.deleteIt();
  }

  async deleteOnServer() {
    await appGlobal.remoteApp.fs.rm(this.path, { recursive: true });
  }

  protected checkChildName(name: string) {
    if (!name || name == "." || name == ".." || /[\/\\\0]/.test(name)) {
      throw new UserError(gt`${name} is not a valid file name`);
    }
  }
}
