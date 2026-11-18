import { ExchangeTags } from "./ExchangeTags";
import type { EWSAccount } from "./EWSAccount";
import type { Tag } from "../../Abstract/Tag";
import { XML2JSON } from "./XML2JSON";
import { base64ToUint8Array, uint8ArrayToBase64 } from "../../util/blob";
import { ensureArray } from "../../util/util";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";

/** The user configuration `CategoryList` in the Calendar folder, as XML, see MS-OXOCFG 2.2.5.2 */
export class EWSTags extends ExchangeTags {
  declare readonly account: EWSAccount;

  get supported(): boolean {
    return true;
  }

  protected async loadFromServer() {
    let xml = await this.getXML();
    return xml ? this.fromXML(xml) : [];
  }

  protected async addOnServer(tag: Tag): Promise<void> {
    let xml = await this.getXML();
    let name = tag.name.toLowerCase();
    if (xml && this.fromXML(xml).some(category => category.name?.toLowerCase() == name)) {
      return;
    }
    await this.saveXML(this.addToXML(xml, tag));
  }

  /** @returns null, if the user has no category list yet */
  protected async getXML(): Promise<Document | null> {
    let request = {
      m$GetUserConfiguration: {
        m$UserConfigurationName: kCategoryListName,
        m$UserConfigurationProperties: "XmlData",
      },
    };
    let xmlData: string;
    try {
      let response = await this.account.callEWS(request);
      xmlData = response.UserConfiguration?.XmlData;
    } catch (ex) {
      if (ex.type == "ErrorItemNotFound") {
        return null;
      }
      throw ex;
    }
    if (!xmlData) {
      return null;
    }
    let text = new TextDecoder().decode(base64ToUint8Array(sanitize.nonemptystring(xmlData)));
    let xml = new DOMParser().parseFromString(text, "text/xml");
    if (xml.getElementsByTagName("parsererror").length || xml.documentElement?.localName != "categories") {
      throw new Error("The category list on the server is not valid");
    }
    return xml;
  }

  protected async saveXML(xml: Document): Promise<void> {
    let text = `<?xml version="1.0"?>\n` + new XMLSerializer().serializeToString(xml.documentElement);
    let userConfiguration = {
      t$UserConfigurationName: kCategoryListName,
      t$XmlData: uint8ArrayToBase64(new TextEncoder().encode(text)),
    };
    try {
      await this.account.callEWS({ m$UpdateUserConfiguration: { m$UserConfiguration: userConfiguration } });
    } catch (ex) {
      if (ex.type != "ErrorItemNotFound") {
        throw ex;
      }
      await this.account.callEWS({ m$CreateUserConfiguration: { m$UserConfiguration: userConfiguration } });
    }
  }

  /** @returns the `<category>` elements, with their attributes */
  protected fromXML(xml: Document): any[] {
    return ensureArray((XML2JSON(xml.documentElement) as any).category);
  }

  /** Changes the XML document instead of writing a new one, to keep the attributes that we don't know, as MS-OXOCFG 3.1.4.2.3 asks.
   * @param xml null = the user has no category list yet */
  protected addToXML(xml: Document | null, tag: Tag): Document {
    let now = new Date().toISOString();
    if (!xml) {
      xml = new DOMParser().parseFromString(`<categories xmlns="CategoryList.xsd" lastSavedSession="0"/>`, "text/xml");
      xml.documentElement.setAttribute("default", tag.name);
    }
    let root = xml.documentElement;
    let category = xml.createElementNS(root.namespaceURI, "category");
    category.setAttribute("name", tag.name);
    category.setAttribute("color", String(this.colorToServer(tag.color)));
    category.setAttribute("keyboardShortcut", "0");
    category.setAttribute("usageCount", "0");
    category.setAttribute("lastTimeUsedMail", now);
    category.setAttribute("lastTimeUsed", now);
    category.setAttribute("lastSessionUsed", "0");
    category.setAttribute("guid", `{${crypto.randomUUID().toUpperCase()}}`);
    root.append(category);
    root.setAttribute("lastSavedTime", now);
    return xml;
  }
}

const kCategoryListName = {
  Name: "CategoryList",
  t$DistinguishedFolderId: {
    Id: "calendar",
  },
};
