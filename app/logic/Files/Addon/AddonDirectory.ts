import { Directory } from "../Directory";
import { AddonFile } from "./AddonFile";
import type { AddonFileSharingAccount } from "./AddonFileSharingAccount";
import type { File } from "../File";
import { Lock } from "../../util/flow/Lock";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { NotSupported } from "../../util/util";
import { gt } from "../../../l10n/l10n";
import type { ArrayColl, Collection } from "svelte-collections";

export class AddonDirectory extends Directory {
  declare account: AddonFileSharingAccount;
  declare readonly files: ArrayColl<AddonFile>;
  declare readonly subDirs: ArrayColl<AddonDirectory>;
  protected readonly listLock = new Lock();

  newDirectory(name: string, dir = new AddonDirectory()): AddonDirectory {
    return super.newDirectory(name, dir) as AddonDirectory;
  }

  newFile(name: string, file = new AddonFile()): AddonFile {
    return super.newFile(name, file) as AddonFile;
  }

  /** Gets the files and subdirectories from the addon, and stores them */
  async listContents() {
    const kMaxEntries = 10000;
    let lock = await this.listLock.lock();
    try {
      let account = this.account;
      let connection = account.connection;
      let list = connection.checkList(await connection.call("listDirectory", this.path), kMaxEntries, "files");
      let listedPaths = new Set<string>();
      let dirsByPath = new Map(this.subDirs.contents.map(dir => [dir.path, dir]));
      let filesByPath = new Map(this.files.contents.map(file => [file.path, file]));
      let currentFiles = new Set<AddonFile>();
      let currentDirs = new Set<AddonDirectory>();
      for (let json of list) {
        try {
          let name = this.checkName(json?.name);
          let isDirectory = json.isDirectory === true;
          let path = this.childPath(name, isDirectory);
          if (listedPaths.has(path)) {
            continue;
          }
          listedPaths.add(path);
          if (isDirectory) {
            let dir = dirsByPath.get(path) ?? this.newDirectory(name);
            dir.fromAddon(json);
            if (!dirsByPath.has(path)) {
              this.subDirs.add(dir);
            }
            currentDirs.add(dir);
          } else {
            let file = filesByPath.get(path) ?? this.newFile(name);
            file.fromAddon(json);
            if (!filesByPath.has(path)) {
              this.files.add(file);
            }
            currentFiles.add(file);
          }
        } catch (ex) {
          account.dataError(ex);
        }
      }

      let removedFiles = this.files.filterOnce(file => !listedPaths.has(file.path));
      let removedDirs = this.subDirs.filterOnce(dir => !listedPaths.has(dir.path));
      this.files.removeAll(removedFiles);
      this.subDirs.removeAll(removedDirs);
      for (let file of removedFiles) {
        await file.deleteLocally();
      }
      for (let dir of removedDirs) {
        await dir.deleteLocally();
      }

      await this.saveLocally();
      for (let dir of currentDirs) {
        await dir.saveLocally();
      }
      for (let file of currentFiles) {
        await file.saveLocally();
      }
    } finally {
      lock.release();
    }
  }

  /** @param json `FileEntryData` from the addon, unchecked */
  fromAddon(json: any) {
    this.lastMod = sanitize.date(json.lastMod, this.lastMod ?? new Date());
  }

  /** @returns A file name without path. The addon gets it back in paths. */
  protected checkName(value: unknown): string {
    const kMaxLength = 255;
    let name = this.account.connection.checkText(value, kMaxLength, null);
    if (!name || name != value || name == "." || name == ".." || /[\/\\]/.test(name)) {
      throw new Error(`${this.account.name}: The addon gave an invalid file name in ${this.path}`);
    }
    return name;
  }

  protected async moveOrCopyFilesOnServer(action: "move" | "copy", files: Collection<File>) {
    let connection = this.account.connection;
    for (let file of files) {
      if (action == "move") {
        await connection.call("move", file.path, this.childPath(file.name));
      } else {
        await file.download();
        await connection.call("upload", this.childPath(file.name), new Uint8Array(await file.contents.arrayBuffer()));
      }
    }
    await this.listContents();
    let source = files.first.parent;
    if (source && source != this) {
      await source.listContents();
    }
  }

  async addFile(file: File) {
    await file.download();
    let newFile = this.newFile(file.name);
    newFile.mimetype = file.mimetype;
    newFile.lastMod = file.lastMod ?? new Date();
    await newFile.saveContentsOnServer(file.contents);
    this.files.add(newFile);
    await newFile.saveLocally();
  }

  async createSubDirectory(name: string): Promise<AddonDirectory> {
    throw new NotSupported(gt`The addon ${this.account.connection.addonName} can't create folders`);
  }

  async deleteOnServer() {
    await this.account.connection.call("delete", this.path);
  }
}
