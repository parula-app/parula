import { ExchangeTags } from "../EWS/ExchangeTags";
import type { GraphAccount } from "./GraphAccount";
import type { TGraphCategory } from "./TGraphMail";
import type { Tag } from "../../Abstract/Tag";
import type { OAuth2 } from "../../Auth/OAuth2";

/** `outlook/masterCategories`, with the colors `preset0` to `preset24` */
export class GraphTags extends ExchangeTags {
  declare readonly account: GraphAccount;

  /** Logins from before we asked for `MailboxSettings.ReadWrite` leave the categories alone */
  get supported(): boolean {
    return !!(this.account.oAuth2 as OAuth2)?.scope?.includes("MailboxSettings.ReadWrite");
  }

  protected async loadFromServer() {
    let categories = await this.account.graphGet<TGraphCategory>("outlook/masterCategories");
    return categories.map(category => ({
      name: category.displayName,
      color: category.color?.replace("preset", ""),
    }));
  }

  protected async addOnServer(tag: Tag): Promise<void> {
    let name = tag.name.toLowerCase();
    let categories = await this.account.graphGet<TGraphCategory>("outlook/masterCategories");
    if (categories.some(category => category.displayName?.toLowerCase() == name)) {
      return;
    }
    let color = this.colorToServer(tag.color);
    await this.account.graphPost("outlook/masterCategories", {
      displayName: tag.name,
      color: color < 0 ? "none" : "preset" + color,
    });
  }
}
