import { FileSharingAccount } from "../FileSharingAccount";
import { HarddriveDirectory } from "./HarddriveDirectory";
import { appGlobal } from "../../app";
import { gt, locale } from "../../../l10n/l10n";

export class HarddriveAccount extends FileSharingAccount {
  readonly protocol: string = "harddrive";

  constructor() {
    super();
    locale.subscribe(() => this.name = gt`My computer *=> My local harddrives`);
  }

  get isLoggedIn(): boolean {
    return true;
  }

  newDirectory(name: string): HarddriveDirectory {
    return super.newDirectory(name, new HarddriveDirectory()) as HarddriveDirectory;
  }

  async sync() {
    if (this.rootDirs.isEmpty) {
      await this.init();
    }
  }

  async init() {
    let platform = await appGlobal.remoteApp.platform();
    const isWindows = platform == "win32";
    const isMac = platform == "darwin";
    const isUnix = platform == "linux" || platform == "sunos" || platform?.includes("bsd");
    const isDesktop = isWindows || isMac || isUnix;

    if (isDesktop) {
      if (isUnix) {
        this.addRootDir(gt`Root *=> Highest level of the file system on the Linux computer`, "/");
      }
      await this.addSpecialDir(gt`Home *=> User directory for his personal files`, "home");
      await this.addSpecialDir(gt`Documents *=> Directory where the user document files are`, "documents");
      await this.addSpecialDir(gt`Downloads *=> Directory where the download files are`, "downloads");
      await this.addSpecialDir(gt`Pictures`, "pictures");
      if (isWindows) {
        await this.addSpecialDir(gt`Recent *=> Recently opened files`, "recent");
      }
      // TODO list drives, e.g. C: etc. - npm drivelist?
    }
  }

  protected addRootDir(label: string, path: string) {
    let dir = this.newDirectory(label);
    dir.path = dir.filepathLocal = path;
    this.rootDirs.add(dir);
  }

  protected async addSpecialDir(label: string, dirname: string) {
    try {
      let path = await appGlobal.remoteApp.directory(dirname);
      if (this.rootDirs.find(dir => dir.path == path)) {
        return;
      }
      let entries = await appGlobal.remoteApp.listDirectoryContents(path, false, false);
      if (!entries?.length) {
        return;
      }
      this.addRootDir(label, path);
    } catch (ex) {
      this.errorCallback(ex);
    }
  }
}

export const myHarddrive = new HarddriveAccount();
