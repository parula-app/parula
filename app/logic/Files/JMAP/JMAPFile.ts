import { File } from "../File";
import type { JMAPDirectory } from "./JMAPDirectory";
import type { JMAPFileAccount } from "./JMAPFileAccount";
import type { TJMAPFileNode } from "./TJMAPFileNode";
import type { TJMAPGetResponse } from "../../Mail/JMAP/TJMAPGeneric";
import { appGlobal } from "../../app";
import { getFilesDir } from "../../util/backend-wrapper";
import { Lock } from "../../util/flow/Lock";
import { LoopGuard } from "../../util/flow/LoopGuard";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { assert } from "../../util/util";

/** A file in a JMAP account.
 * If we have it on disk, `syncLocalCopy()` keeps the file on disk and the file on the server
 * in sync, using the algorithm in `JMAPFileSync.md`. */
export class JMAPFile extends File {
  declare parent: JMAPDirectory;
  /** FileNode ID. null = not yet on the server */
  nodeID: string | null = null;
  /** The file on disk, as we last wrote it or uploaded it.
   * null = we don't have it on disk, or never synced it */
  localCopy: LocalCopy | null = null;
  /** The server version that is in `contents` */
  protected contentsBlobID: string | null = null;
  protected readonly syncLock = new Lock();

  get account(): JMAPFileAccount {
    return this.parent?.account;
  }

  /** The current contents on the server. Changes with every change of the contents. */
  get blobID(): string | null {
    return this.syncState as string;
  }
  set blobID(val: string | null) {
    this.syncState = val;
  }

  fromJMAP(json: TJMAPFileNode) {
    this.nodeID = sanitize.alphanumdash(json.id);
    this.setFileName(sanitize.nonemptylabel(json.name));
    this.path = this.parent.childPath(this.name);
    this.blobID = sanitize.alphanumdash(json.blobId, null);
    this.size = sanitize.integerRange(json.size, 0, Number.MAX_SAFE_INTEGER, 0);
    this.mimetype = sanitize.nonemptystring(json.mediaType ?? json.type, "application/octet-stream");
    this.lastModOnServer = sanitize.date(json.modified, new Date());
    this.lastMod = new Date(this.lastModOnServer);
    if (this.contents && this.contentsBlobID != this.blobID && !this.filepathLocal) {
      this.clearURL();
      this.contents = null;
    }
  }

  async download() {
    if (this.filepathLocal) {
      try {
        await this.syncLocalCopy();
      } catch (ex) {
        this.account.errorCallback(ex); // e.g. offline. The file on disk is still there.
      }
    }
    if (this.contents) {
      return;
    }
    await this.readLocalFile();
    if (this.contents) {
      return;
    }
    await this.downloadRunOnce.runOnce(async () => {
      let lock = await this.syncLock.lock();
      try {
        if (this.contents) {
          return;
        }
        let contents = await this.downloadServerVersion();
        // #if [!WEBMAIL]
        await this.writeLocalFile(contents);
        // #endif
      } finally {
        lock.release();
      }
    });
  }

  async upload() {
    await this.syncLocalCopy();
  }

  /** @returns We uploaded or downloaded changes */
  async uploadIfChanged(): Promise<boolean> {
    let before = this.blobID;
    await this.syncLocalCopy();
    return before != this.blobID;
  }

  /** Compares the file on disk with the server, and brings both to the same state.
   * @see JMAPFileSync.md */
  async syncLocalCopy() {
    let lock = await this.syncLock.lock();
    try {
      const kMaxRounds = 5;
      let loop = new LoopGuard(kMaxRounds, () => {
        throw new Error(`${this.name}: The file keeps changing on the server. We'll try again later.`);
      });
      while (loop.nextRound()) {
        if (await this.syncLocalCopyStep()) {
          return;
        }
      }
    } finally {
      lock.release();
    }
  }

  /** @returns Done. false = The state changed, so call again. */
  protected async syncLocalCopyStep(): Promise<boolean> {
    if (!this.filepathLocal) {
      return true;
    }
    let localChanged: boolean;
    try {
      localChanged = await this.isLocalFileChanged();
    } catch (ex) {
      if (ex.code != "ENOENT") {
        throw ex;
      }
      // The user deleted the file on disk. It was only our copy.
      await this.deleteLocalCache();
      await this.saveLocally();
      return true;
    }
    await this.moveLocalFile();
    if (localChanged) {
      this.clearURL();
      this.contents = null;
      this.contentsBlobID = null;
    }
    if (!this.nodeID) {
      await this.createOnServer();
      return true;
    }
    let serverChanged = this.blobID != this.localCopy?.blobID;
    if (!localChanged && !serverChanged) {
      return true;
    }
    if (!serverChanged) {
      return await this.uploadLocalChanges();
    }
    if (!localChanged) {
      await this.updateLocalCopy();
      return true;
    }
    return await this.resolveConflict();
  }

  /** @returns The file on disk is different from what we wrote or uploaded
   * @throws ENOENT, when the file is no longer on disk */
  async isLocalFileChanged(): Promise<boolean> {
    if (!this.filepathLocal) {
      return false;
    }
    let stat = await appGlobal.remoteApp.statFile(this.filepathLocal);
    if (!this.localCopy) {
      return true;
    }
    return stat.size != this.localCopy.size ||
      Math.floor(new Date(stat.lastMod).getTime() / 1000) != Math.floor(this.localCopy.lastMod.getTime() / 1000);
  }

  /** Only the user changed the file, on disk.
   * @returns false, if the file changed on the server in the meantime */
  protected async uploadLocalChanges(): Promise<boolean> {
    let stat = await appGlobal.remoteApp.statFile(this.filepathLocal); // before reading, so that a change while we read is noticed next time
    let lastMod = new Date(stat.lastMod);
    let contents = await this.readFromDisk(this.filepathLocal);
    let blobID = await this.account.uploadContents(contents, this.name, this.mimetype);
    let updated = await this.account.updateFileIfUnchanged(this.nodeID, this.localCopy?.blobID ?? this.blobID, {
      blobId: blobID,
      modified: lastMod.toISOString(),
    });
    if (!updated) {
      await this.refresh();
      return false;
    }
    this.blobID = blobID;
    this.size = contents.size;
    this.lastMod = new Date(lastMod);
    this.lastModOnServer = new Date(lastMod);
    this.localCopy = { blobID, lastMod, size: stat.size };
    await this.saveLocally();
    return true;
  }

  protected async updateLocalCopy() {
    let contents = await this.downloadServerVersion();
    try {
      await this.writeLocalFile(contents);
    } catch (ex) {
      if (!this.isLocked(ex)) {
        throw ex;
      }
      // Another app has the file open and locked, e.g. on Windows. We'll try again later, and `contents` keeps the download.
    }
  }

  /** Both the user on disk and somebody else on the server changed the file.
   * Keeps both versions, as two files.
   * @returns false, if this needs another round */
  protected async resolveConflict(): Promise<boolean> {
    let stat = await appGlobal.remoteApp.statFile(this.filepathLocal);
    let localLastMod = new Date(stat.lastMod);
    let localContents = await this.readFromDisk(this.filepathLocal);
    let serverContents = await this.downloadServerVersion();
    let localBytes = new Uint8Array(await localContents.arrayBuffer());
    let serverBytes = new Uint8Array(await serverContents.arrayBuffer());
    if (localBytes.length == serverBytes.length && localBytes.every((byte, i) => byte == serverBytes[i])) {
      // Both made the same change
      this.localCopy = { blobID: this.blobID, lastMod: localLastMod, size: stat.size };
      await this.saveLocally();
      return true;
    }

    let modifiedName = this.conflictName("modified", localLastMod);
    let modifiedPath = await this.freeLocalPath(modifiedName);
    try {
      await appGlobal.remoteApp.fs.rename(this.filepathLocal, modifiedPath);
    } catch (ex) {
      if (!this.isLocked(ex)) {
        throw ex;
      }
      // Another app has the file open and locked it, e.g. on Windows. So, the file on disk keeps
      // the user's version, and the server version goes into a new file.
      let serverName = this.conflictName("server", this.lastModOnServer);
      let serverPath = await this.freeLocalPath(serverName);
      await this.writeToDisk(serverPath, serverContents, this.lastModOnServer);
      await this.parent.addLocalFile(serverName, serverPath, this.mimetype, this.blobID);
      // The user's version is now based on the server version, so that the next round uploads it
      this.localCopy = { blobID: this.blobID, lastMod: new Date(0), size: -1 };
      await this.saveLocally();
      return false;
    }
    await this.writeLocalFile(serverContents);
    await this.parent.addLocalFile(modifiedName, modifiedPath, this.mimetype);
    return true;
  }

  /** The server deleted this file.
   * @param survivor If the user changed the file on disk, then we keep it in this directory, as new file. */
  async removedOnServer(survivor: JMAPDirectory) {
    let lock = await this.syncLock.lock();
    try {
      await this.keepLocalChanges(survivor);
    } finally {
      lock.release();
    }
  }

  /** Like `removedOnServer()`, for when we already have the `syncLock` */
  protected async keepLocalChanges(survivor: JMAPDirectory) {
    let localChanged = false;
    try {
      localChanged = await this.isLocalFileChanged();
    } catch (ex) {
      if (ex.code != "ENOENT") {
        throw ex;
      }
    }
    if (!localChanged) {
      await this.deleteLocally();
      return;
    }
    let stat = await appGlobal.remoteApp.statFile(this.filepathLocal);
    this.nodeID = null;
    this.blobID = null;
    this.localCopy = null;
    this.setFileName(this.conflictName("modified", new Date(stat.lastMod)));
    this.moveTo(survivor);
    await this.saveLocally();
    await this.moveLocalFile();
    await this.createOnServer();
  }

  /** Uploads a file that we have only on disk */
  async createOnServer(blobID?: string) {
    let stat = await appGlobal.remoteApp.statFile(this.filepathLocal);
    let lastMod = new Date(stat.lastMod);
    blobID ??= await this.account.uploadContents(await this.readFromDisk(this.filepathLocal), this.name, this.mimetype);
    let created = await this.account.setNodes({
      create: {
        file: this.account.newNodeJSON("File", {
          name: this.name,
          parentId: this.parent.nodeID,
          blobId: blobID,
          mediaType: this.mimetype,
          modified: lastMod.toISOString(),
        }),
      },
      onExists: "rename",
    });
    let json = created["file"];
    this.nodeID = sanitize.alphanumdash(json?.id);
    for (let duplicate of this.parent.files.filterOnce(file => file.nodeID == this.nodeID && file != this)) {
      await duplicate.deleteLocally(); // The push notification was faster
    }
    if (json.name) {
      this.setFileName(sanitize.nonemptylabel(json.name, this.name)); // The server changed the name, because it's taken
    }
    this.path = this.parent.childPath(this.name);
    this.blobID = blobID;
    this.size = stat.size;
    this.lastMod = new Date(lastMod);
    this.lastModOnServer = new Date(lastMod);
    this.localCopy = { blobID, lastMod, size: stat.size };
    await this.saveLocally();
  }

  protected async refresh() {
    let response = await this.account.jmapAccount.makeSingleCall("FileNode/get", {
      accountId: this.account.jmapAccount.accountID,
      ids: [this.nodeID],
    }) as TJMAPGetResponse<TJMAPFileNode>;
    let json = response.list.find(json => json.id == this.nodeID);
    if (json) {
      await this.account.applyServerNode(json);
      return;
    }
    await this.keepLocalChanges(this.parent);
  }

  async saveOnServer() {
    await this.upload();
  }

  async renameOnServer(newName: string) {
    if (!this.nodeID) {
      return;
    }
    await this.account.setNodes({
      update: {
        [this.nodeID]: { name: newName },
      },
    });
    this.path = this.parent.childPath(newName);
  }

  async deleteOnServer() {
    if (!this.nodeID) {
      return;
    }
    await this.account.setNodes({
      destroy: [this.nodeID],
    });
  }

  async deleteLocalCache() {
    this.localCopy = null;
    this.contentsBlobID = null;
    let filepath = this.filepathLocal;
    try {
      await super.deleteLocalCache();
    } catch (ex) {
      if (!this.isLocked(ex) && ex.code != "ENOENT") {
        throw ex;
      }
    }
    if (filepath) {
      await this.removeEmptyLocalDirs(filepath);
    }
  }

  moveTo(parent: JMAPDirectory) {
    if (parent != this.parent) {
      this.parent?.files.remove(this);
      this.parent = parent;
    }
    if (!parent.files.contains(this)) {
      parent.files.add(this);
    }
    this.path = parent.childPath(this.name);
  }

  protected async readLocalFile(): Promise<void> {
    this.contentsBlobID = null;
    await super.readLocalFile();
  }

  protected async downloadServerVersion(): Promise<Blob> {
    if (this.contents && this.contentsBlobID == this.blobID) {
      return this.contents;
    }
    assert(this.blobID, `${this.name}: The server has no contents for this file`);
    let blobID = this.blobID;
    let contents = await this.account.downloadContents(blobID, this.name, this.mimetype);
    this.clearURL();
    this.contents = contents;
    this.contentsBlobID = blobID;
    return contents;
  }

  /** Writes the server version into our file on disk */
  protected async writeLocalFile(contents: Blob) {
    this.filepathLocal ??= await this.getLocalFilePath();
    let stat = await this.writeToDisk(this.filepathLocal, contents, this.lastModOnServer);
    this.localCopy = { blobID: this.contentsBlobID ?? this.blobID, lastMod: new Date(stat.lastMod), size: stat.size };
    await this.saveLocally();
  }

  /** @param lastMod The modification time for the file on disk */
  protected async writeToDisk(filepath: string, contents: Blob, lastMod: Date) {
    await appGlobal.remoteApp.writeFile(filepath, 0o600, new Uint8Array(await contents.arrayBuffer()));
    await appGlobal.remoteApp.fs.utimes(filepath, new Date(), lastMod);
    return await appGlobal.remoteApp.statFile(filepath);
  }

  protected async readFromDisk(filepath: string): Promise<Blob> {
    let bytes = await appGlobal.remoteApp.readFile(filepath);
    return new Blob([bytes], { type: this.mimetype });
  }

  /** Where the file is on the server, see `File.getLocalFilePath()`,
   * but with a number, if the name is already taken on disk */
  protected async getLocalFilePath(): Promise<string> {
    return await this.uniqueLocalPath(await super.getLocalFilePath());
  }

  /** After a rename or move on the server, of the file or of a parent directory,
   * moves the file on disk to the same place. If another app has the file locked,
   * the file stays where it is, and the next sync tries again. */
  protected async moveLocalFile() {
    let wanted = await super.getLocalFilePath();
    if (this.isLocalPathFor(wanted)) {
      return;
    }
    let oldPath = this.filepathLocal;
    let newPath = await this.uniqueLocalPath(wanted);
    try {
      await appGlobal.remoteApp.fs.rename(oldPath, newPath);
    } catch (ex) {
      if (this.isLocked(ex)) {
        return;
      }
      throw ex;
    }
    this.filepathLocal = newPath;
    await this.saveLocally();
    await this.removeEmptyLocalDirs(oldPath);
  }

  /** @returns `filepathLocal` is `filepath`, or `filepath` with a number from `uniqueLocalPath()` */
  protected isLocalPathFor(filepath: string): boolean {
    let local = this.filepathLocal;
    if (local == filepath) {
      return true;
    }
    let { base, ext } = this.splitExt(filepath);
    let number = local.substring(base.length + 1, local.length - ext.length);
    return local.startsWith(base + "-") && local.endsWith(ext) && /^[1-9][0-9]*$/.test(number);
  }

  /** @returns `filepath`, or, if that is already taken on disk,
   * with a number before the extension, e.g. `report-1.docx` */
  protected async uniqueLocalPath(filepath: string): Promise<string> {
    let { base, ext } = this.splitExt(filepath);
    const kMaxTries = 100;
    for (let i = 0; i <= kMaxTries; i++) {
      let candidate = i ? `${base}-${i}${ext}` : filepath;
      try {
        await appGlobal.remoteApp.fs.stat(candidate);
      } catch (ex) {
        if (ex.code == "ENOENT") {
          return candidate;
        }
        throw ex;
      }
    }
    throw new Error(`${this.name}: Too many files with this name`);
  }

  /** E.g. `/dir/report.docx` -> `/dir/report` and `.docx` */
  protected splitExt(filepath: string): { base: string, ext: string } {
    let dot = filepath.lastIndexOf(".");
    if (dot <= filepath.lastIndexOf("/") + 1) {
      return { base: filepath, ext: "" };
    }
    return { base: filepath.substring(0, dot), ext: filepath.substring(dot) };
  }

  /** A path for a new file in the same directory on disk as our file, which is not yet taken */
  protected async freeLocalPath(name: string): Promise<string> {
    let dir = await appGlobal.remoteApp.path.dirname(this.filepathLocal);
    return await this.uniqueLocalPath(`${dir}/${sanitize.filename(name, "file")}`);
  }

  /** Removes the directories on disk above `filepath` that are now empty, up to the directory of the account */
  protected async removeEmptyLocalDirs(filepath: string) {
    let accountDir = `${await getFilesDir()}/files/cloud/${this.account.id}/`;
    let dir = filepath.substring(0, filepath.lastIndexOf("/"));
    while (dir.startsWith(accountDir)) {
      try {
        await appGlobal.remoteApp.fs.rmdir(dir);
      } catch (ex) {
        if (["ENOTEMPTY", "EEXIST", "ENOENT"].includes(ex.code) || this.isLocked(ex)) {
          return;
        }
        throw ex;
      }
      dir = dir.substring(0, dir.lastIndexOf("/"));
    }
  }

  /** E.g. `report-modified-26-10-21-14-03-59.docx`. The date is in local time. */
  protected conflictName(kind: "modified" | "server", date: Date): string {
    let stamp = [date.getFullYear() % 100, date.getMonth() + 1, date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds()]
      .map(number => String(number).padStart(2, "0"))
      .join("-");
    return `${this.nameWithoutExt}-${kind}-${stamp}` + (this.ext ? "." + this.ext : "");
  }

  /** Another app has the file open, and the operating system doesn't let us change it, e.g. on Windows */
  protected isLocked(ex: any): boolean {
    return ["EBUSY", "EPERM", "EACCES"].includes(ex?.code);
  }

  toExtraJSON(): any {
    let json = super.toExtraJSON();
    json.nodeID = this.nodeID;
    json.localCopy = this.localCopy && {
      blobID: this.localCopy.blobID,
      lastMod: this.localCopy.lastMod.toISOString(),
      size: this.localCopy.size,
    };
    return json;
  }
  fromExtraJSON(json: any) {
    super.fromExtraJSON(json);
    this.nodeID = sanitize.alphanumdash(json?.nodeID, null);
    this.localCopy = json?.localCopy
      ? {
        blobID: sanitize.alphanumdash(json.localCopy.blobID, null),
        lastMod: sanitize.date(json.localCopy.lastMod, new Date(0)),
        size: sanitize.integer(json.localCopy.size, -1),
      }
      : null;
  }
}

interface LocalCopy {
  /** The server version that the file on disk is based on */
  blobID: string | null;
  /** of the file on disk */
  lastMod: Date;
  /** of the file on disk */
  size: number;
}
