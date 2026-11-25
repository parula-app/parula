import { File } from "../File";
import type { HarddriveDirectory } from "./HarddriveDirectory";
import { appGlobal } from "../../app";

export class HarddriveFile extends File {
  declare parent: HarddriveDirectory;

  async download() {
    if (this.contents) {
      return;
    }
    await this.downloadRunOnce.runOnce(async () => {
      if (this.contents) {
        return;
      }
      let bytes = await appGlobal.remoteApp.readFile(this.path);
      this.contents = new Blob([bytes], { type: this.mimetype });
    });
  }

  /** The file on disk is the file itself, not a cache */
  async deleteLocalCache() {
    this.clearURL();
    this.contents = null;
    this.executable = undefined;
  }

  async deleteOnServer() {
    await appGlobal.remoteApp.deleteFile(this.path);
  }

  async saveOnServer() {
    if (!this.contents) {
      return;
    }
    let contents = new Uint8Array(await this.contents.arrayBuffer());
    await appGlobal.remoteApp.fs.writeFile(this.path, contents, { mode: 0o600 });
  }

  async renameOnServer(newName: string) {
    await this.parent.renameChild(this, newName);
  }

  setPath(path: string) {
    this.path = this.filepathLocal = path;
  }
}
