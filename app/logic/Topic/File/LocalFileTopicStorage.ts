import { FileTopicStorage } from "./FileTopicStorage";
import type { TopicAccount } from "../TopicAccount";
import { appGlobal } from "../../app";
import { getFilesDir } from "../../util/backend-wrapper";

/** The files of the topics on this computer, in the files folder of the app, `topics/<account ID>/` */
export class LocalFileTopicStorage extends FileTopicStorage {
  protected readonly account: TopicAccount;
  /** With the files of all topics of the account. Created with the first file. */
  protected folder: string;

  constructor(account: TopicAccount) {
    super();
    this.account = account;
  }

  protected async listFolder(path: string): Promise<{ name: string, isDirectory: boolean, lastMod: Date }[]> {
    try {
      return await appGlobal.remoteApp.listDirectoryContents(await this.fullPath(path), true, false);
    } catch (ex) {
      if (ex.code == "ENOENT") {
        return [];
      }
      throw ex;
    }
  }

  protected async readFile(path: string): Promise<string> {
    return await appGlobal.remoteApp.fs.readFile(await this.fullPath(path), { encoding: "utf-8" });
  }

  protected async writeFile(path: string, content: string, time: Date): Promise<void> {
    let file = await this.fullPath(path);
    let fs = appGlobal.remoteApp.fs;
    await fs.mkdir(file.substring(0, file.lastIndexOf("/")), { recursive: true });
    await fs.writeFile(file, content);
    await fs.utimes(file, time.getTime() / 1000, time.getTime() / 1000);
  }

  protected async rename(from: string, to: string): Promise<void> {
    let target = await this.fullPath(to);
    let fs = appGlobal.remoteApp.fs;
    await fs.mkdir(target.substring(0, target.lastIndexOf("/")), { recursive: true });
    try {
      await fs.rename(await this.fullPath(from), target);
    } catch (ex) {
      if (ex.code != "ENOENT") {
        throw ex;
      }
    }
  }

  protected async remove(path: string): Promise<void> {
    await appGlobal.remoteApp.fs.rm(await this.fullPath(path), { recursive: true, force: true });
  }

  protected async fullPath(path: string): Promise<string> {
    this.folder ??= (await getFilesDir()) + "/topics/" + this.account.id;
    return this.folder + "/" + path;
  }
}
