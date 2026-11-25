import { TopicLink, TopicLinkType } from "./TopicLink";
import { File } from "../../Files/File";
import type { Directory } from "../../Files/Directory";
import { HarddriveFile } from "../../Files/Harddrive/HarddriveFile";
import { appGlobal } from "../../app";

/** A `file:` URL on the harddrive, or the URL of the file on the server */
export class FileLink extends TopicLink {
  readonly type = TopicLinkType.File;
  static readonly targetClass = File;
  protected readonly idProperty = "@id";
  protected readonly dateProperty = "dateModified";
  declare target: File | null;

  setTarget(file: File) {
    super.setTarget(file);
    let url = file.account?.url;
    this.targetID = file instanceof HarddriveFile ? "file://" + encodeURI(file.filepathLocal ?? file.path)
      : url ? (url.endsWith("/") ? url : url + "/") + (file.path.startsWith("/") ? file.path.substring(1) : file.path)
      : null;
    this.name = file.name;
    this.date = file.lastMod;
  }

  async findTarget(): Promise<File | null> {
    if (this.targetID.startsWith("file://")) {
      let path = decodeURI(this.targetID.substring("file://".length));
      try {
        await appGlobal.remoteApp.fs.access(path);
      } catch (ex) {
        return this.target = null;
      }
      let file = new HarddriveFile();
      file.setFileName(path.substring(path.lastIndexOf("/") + 1));
      file.path = file.filepathLocal = path;
      file.lastMod = this.date ?? file.lastMod;
      return this.target = file;
    }
    for (let account of appGlobal.fileSharingAccounts) {
      let url = account.url?.endsWith("/") ? account.url : account.url + "/";
      if (account.url && this.targetID.startsWith(url)) {
        let path = this.targetID.substring(url.length);
        let file = findFile(account.rootDirs.contents, path) ?? findFile(account.rootDirs.contents, "/" + path);
        if (file) {
          return this.target = file;
        }
      }
    }
    return this.target = null;
  }
}

/** Only in the directories that we already listed */
function findFile(dirs: Directory[], path: string): File | null {
  for (let dir of dirs) {
    let file = dir.files.find(file => file.path == path) ?? findFile(dir.subDirs.contents, path);
    if (file) {
      return file;
    }
  }
  return null;
}
