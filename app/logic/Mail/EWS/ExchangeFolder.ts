import { Folder } from "../Folder";
import { ExchangePermission } from "./ExchangePermission";
import { AbstractFunction } from "../../util/util";
import { gt } from "../../../l10n/l10n";

export class ExchangeFolder extends Folder {
  disableChangeSpecial(): string | false {
    return gt`You cannot change special folders on the Exchange server`;
  }

  async getPermissions(): Promise<ExchangePermission[]> {
    throw new AbstractFunction();
  }

  /** Whether `emailAddress` may create items, e.g. save a sent copy, in this shared folder.
   * Reading the permissions is itself denied unless we own the folder, so treat that
   * as "not allowed", letting the caller save the copy in his own folder instead. */
  async mayCreateItems(emailAddress: string): Promise<boolean> {
    try {
      // this.getPermissions() can throw
      return ExchangePermission.mayCreateItems(await this.getPermissions(), emailAddress);
    } catch (ex) {
      return false;
    }
  }
}
