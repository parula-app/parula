import { ExchangeGroup } from './ExchangeGroup';
import { findOrCreatePerson } from '../../Abstract/PersonUID';
import type { EWSAddressbook } from './EWSAddressbook';
import { EWSCreateItemRequest } from "../../Mail/EWS/Request/EWSCreateItemRequest";
import { EWSDeleteItemRequest } from "../../Mail/EWS/Request/EWSDeleteItemRequest";
import { EWSUpdateItemRequest } from "../../Mail/EWS/Request/EWSUpdateItemRequest";
import { getEmailAddressOrX400 } from '../../Mail/EWS/EWSEMail';
import { ensureArray } from "../../util/util";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";

export class EWSGroup extends ExchangeGroup {
  declare addressbook: EWSAddressbook | null;

  /** The Exchange ItemId,
   * or the empty string if the item has not been saved to the server. */
  itemID = "";

  fromXML(xmljs: any) {
    this.itemID = sanitize.nonemptystring(xmljs.ItemId.Id);
    this.name = sanitize.nonemptystring(xmljs.DisplayName, "");
    this.description = sanitize.nonemptystring(xmljs.Body?.Value, "");
    this.participants.replaceAll(ensureArray(xmljs.Members?.Member).map(member => findOrCreatePerson(getEmailAddressOrX400(member.Mailbox.EmailAddress), sanitize.nonemptystring(member.Mailbox.Name, null))));
  }

  async saveToServer() {
    // XXX untested due to no UI yet
    let request = this.itemID ? new EWSUpdateItemRequest(this.itemID) : new EWSCreateItemRequest({ m$SavedItemFolderId: { t$FolderId: { Id: this.addressbook.folderID } } });
    // `null`, not `""`, so that an empty description results in a field deletion, not an invalid empty <t:Body/>
    request.addField("DistributionList", "Body", this.description ? { BodyType: "Text", _TextContent_: this.description } : null, "item:Body");
    request.addField("DistributionList", "DisplayName", this.name, "contacts:DisplayName");
    let participants = this.participants.contents.filter(entry => entry.emailAddresses.first?.value);
    request.addField("DistributionList", "Members", participants.length ? {
      t$Member: participants.map(entry => ({
        t$Mailbox: {
         t$EmailAddress: entry.emailAddresses.first.value,
         t$Name: entry.name,
        },
      })),
    } : "", "distributionlist:Members");
    let response = await this.addressbook.account.callEWS(request);
    this.itemID = sanitize.nonemptystring(response.Items.DistributionList.ItemId.Id);
  }

  async deleteFromServer() {
    if (!this.itemID) {
      return;
    }
    let request = new EWSDeleteItemRequest(this.itemID, { DeleteType: "HardDelete" });
    await this.addressbook.account.callEWS(request);
  }

  fromExtraJSON(json: any) {
    super.fromExtraJSON(json);
    // Old existing contacts saved the itemID in the id
    this.itemID = sanitize.string(json.itemID, this.id);
  }

  toExtraJSON(): any {
    let json = super.toExtraJSON();
    json.itemID = this.itemID;
    return json;
  }
}
