import { Person } from "../../Abstract/Person";
import type { AddonAddressbook } from "./AddonAddressbook";
import { convertVCardToPerson, getUpdatedVCard, parseContact, personToVCard } from "../VCard/VCard";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";

export class AddonPerson extends Person {
  declare addressbook: AddonAddressbook | null;
  /** ID of the contact on the server. null = not saved there yet. */
  serverID: string | null = null;
  /** The vCard that the addon gave.
   * Allows updates of only the properties that we know about, leaving unknown properties as-is. */
  originalVCard: string | null = null;

  /** @param vcard from the addon, unchecked */
  fromAddon(id: string, vcard: string) {
    const kMaxLength = 10000;
    convertVCardToPerson(vcard, this);
    this.serverID = id;
    this.originalVCard = vcard;
    this.name = this.addressbook.connection.checkText(this.name, kMaxLength, "");
    // A URL would load from anywhere, also from servers that the addon may not reach
    if (!this.picture?.startsWith("data:image/")) {
      this.picture = null;
    }
  }

  async saveToServer() {
    let connection = this.addressbook.connection;
    let vcard = this.originalVCard
      ? getUpdatedVCard(this, parseContact(this.originalVCard))
      : personToVCard(this);
    this.serverID = connection.checkID(await connection.call("saveContact", this.serverID, vcard));
    this.originalVCard = vcard;
    await super.saveToServer();
  }

  async deleteFromServer() {
    if (!this.serverID) {
      return;
    }
    await this.addressbook.connection.call("deleteContact", this.serverID);
  }

  fromExtraJSON(json: any) {
    super.fromExtraJSON(json);
    this.serverID = sanitize.nonemptystring(json.serverID, null);
    this.originalVCard = sanitize.string(json.original, null);
  }
  toExtraJSON(): any {
    let json = super.toExtraJSON();
    json.serverID = this.serverID;
    json.original = this.originalVCard;
    return json;
  }
}
