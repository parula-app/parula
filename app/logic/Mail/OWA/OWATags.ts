import { ExchangeTags } from "../EWS/ExchangeTags";
import type { OWAAccount } from "./OWAAccount";
import { OWAError } from "./OWAError";
import type { Tag } from "../../Abstract/Tag";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { gt } from "../../../l10n/l10n";

/** `MasterCategoryList` from `GetOwaUserConfiguration`, which is where OWA itself gets it */
export class OWATags extends ExchangeTags {
  declare readonly account: OWAAccount;

  get supported(): boolean {
    return true;
  }

  protected async loadFromServer() {
    let configuration = await this.account.callOWA(new OWAGetOwaUserConfigurationRequest());
    return sanitize.array(configuration.MasterCategoryList?.MasterList, []).map(category => ({
      name: category?.Name,
      color: category?.Color,
    }));
  }

  /** The server skips names that it already has */
  protected async addOnServer(tag: Tag): Promise<void> {
    let response = await this.account.callOWA(new OWAUpdateMasterCategoryListRequest([{
      __type: "CategoryType:#Exchange",
      Id: crypto.randomUUID(),
      Name: tag.name,
      Color: this.colorToServer(tag.color),
      LastTimeUsed: new Date().toISOString(),
    }]));
    if (response.WasSuccessful === false) {
      throw new OWAError({ message: gt`Could not add the tag ${tag.name} as category to the server`, json: response });
    }
  }
}

class OWAGetOwaUserConfigurationRequest {
  get action() {
    return "GetOwaUserConfiguration";
  }
}

class OWAUpdateMasterCategoryListRequest {
  readonly request: any;

  constructor(addCategories: any[]) {
    this.request = {
      __type: "UpdateMasterCategoryListRequest:#Exchange",
      AddCategoryList: addCategories,
    };
  }

  get action() {
    return "UpdateMasterCategoryList";
  }
}
