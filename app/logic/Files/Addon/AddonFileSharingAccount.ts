import { FileSharingAccount } from "../FileSharingAccount";
import { AddonDirectory } from "./AddonDirectory";
import { AuthMethod } from "../../Abstract/Account";
import { AddonConnection } from "../../Addons/AddonConnection";
import { appGlobal } from "../../app";
import { gt } from "../../../l10n/l10n";
import type { ArrayColl } from "svelte-collections";

/** A file sharing account whose protocol an addon implements.
 * The addon does only the server talk. Directories and files are stored like those of other protocols. */
export class AddonFileSharingAccount extends FileSharingAccount {
  readonly protocol: string;
  readonly connection = new AddonConnection(this, appGlobal.fileSharingAccounts);
  declare readonly rootDirs: ArrayColl<AddonDirectory>;

  /** @param protocol `AddonProtocol.accountProtocol()` */
  constructor(protocol: string) {
    super();
    this.protocol = protocol;
    this.authMethod = AuthMethod.Password;
  }

  newDirectory(name: string, dir = new AddonDirectory()): AddonDirectory {
    return super.newDirectory(name, dir) as AddonDirectory;
  }

  get isLoggedIn(): boolean {
    return this.connection.isLoggedIn;
  }

  async login(interactive: boolean): Promise<void> {
    await super.login(interactive);
    await this.connection.login();
  }

  async verifyLogin(): Promise<void> {
    await this.connection.verifyLogin();
  }

  async disconnect(): Promise<void> {
    this.connection.disconnect();
  }

  /** Lists the top directory */
  async sync() {
    await super.sync();
    if (this.rootDirs.isEmpty) {
      let root = this.newDirectory(gt`Files`);
      root.path = "/";
      this.rootDirs.add(root);
      await root.saveLocally();
    }
    await this.rootDirs.first.listContents();
  }

  fromConfigJSON(json: any) {
    super.fromConfigJSON(json);
    this.connection.fromConfigJSON(json);
  }
  toConfigJSON(): any {
    let json = super.toConfigJSON();
    this.connection.toConfigJSON(json);
    return json;
  }
}
