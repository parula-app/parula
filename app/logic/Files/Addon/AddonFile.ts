import { File } from "../File";
import type { AddonDirectory } from "./AddonDirectory";
import { appGlobal } from "../../app";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";

export class AddonFile extends File {
  declare parent: AddonDirectory;

  get account() {
    return this.parent?.account;
  }

  /** @param json `FileEntryData` from the addon, unchecked */
  fromAddon(json: any) {
    let size = this.account.connection.checkCount(json.size, 0);
    let lastMod = sanitize.date(json.lastMod, new Date());
    if (typeof json.mimetype == "string" && json.mimetype.length <= 100 && /^[\w.+-]+\/[\w.+-]+$/.test(json.mimetype)) {
      this.mimetype = json.mimetype;
    }
    let hasLocalChanges = this.lastModOnServer && this.lastModOnServer.getTime() != this.lastMod.getTime();
    let changedOnServer = this.size != size || this.lastModOnServer?.getTime() != lastMod.getTime();
    if (this.filepathLocal && !hasLocalChanges && changedOnServer) {
      this.deleteLocalCache()
        .catch(this.account.errorCallback);
    }
    this.size = size;
    this.lastMod = lastMod;
    this.lastModOnServer = new Date(lastMod);
  }

  async download() {
    const kMaxSize = 1024 * 1024 * 1024;
    if (this.contents) {
      return;
    }
    await this.readLocalFile();
    if (this.contents) {
      return;
    }
    await this.downloadRunOnce.runOnce(async () => {
      if (this.contents) {
        return;
      }
      let account = this.account;
      let contents = await account.connection.call("download", this.path);
      if (!(contents instanceof Uint8Array) || contents.byteLength > kMaxSize) {
        throw new Error(`${account.name}: The addon gave no contents for ${this.name}, or more than 1 GB`);
      }
      this.clearURL();
      this.contents = new Blob([contents as Uint8Array<ArrayBuffer>], this.mimetype ? { type: this.mimetype } : undefined);
      await this.saveAsLocalFile();
      await appGlobal.remoteApp.fs.utimes(this.filepathLocal, new Date(), this.lastModOnServer ?? this.lastMod);
    });
  }

  async upload(): Promise<void> {
    await this.readLocalFile();
    await this.saveContentsOnServer(this.contents);
  }

  async saveContentsOnServer(contents: Blob) {
    await this.account.connection.call("upload", this.path, new Uint8Array(await contents.arrayBuffer()));
    this.size = contents.size;
    this.lastModOnServer = new Date(this.lastMod);
  }

  /** Renames on the server */
  async saveOnServer() {
    let newPath = this.parent.childPath(this.name);
    if (newPath == this.path) {
      return;
    }
    await this.account.connection.call("move", this.path, newPath);
    this.path = newPath;
    await this.saveLocally();
  }

  async deleteOnServer() {
    await this.account.connection.call("delete", this.path);
  }
}
