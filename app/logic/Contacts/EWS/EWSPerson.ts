import { ExchangePerson, kPictureFilename } from "./ExchangePerson";
import { ContactEntry } from '../../Abstract/Person';
import { StreetAddress } from '../StreetAddress';
import type { EWSAddressbook } from './EWSAddressbook';
import { EWSCreateItemRequest } from "../../Mail/EWS/Request/EWSCreateItemRequest";
import { EWSDeleteItemRequest } from "../../Mail/EWS/Request/EWSDeleteItemRequest";
import { EWSUpdateItemRequest } from "../../Mail/EWS/Request/EWSUpdateItemRequest";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { ensureArray } from "../../util/util";
import { blobToBase64, dataURLToBlob } from "../../util/blob";
import { ArrayColl } from "svelte-collections";

export class EWSPerson extends ExchangePerson {
  declare addressbook: EWSAddressbook | null;

  /** The Exchange ItemId,
   * or the empty string if the item has not been saved to the server. */
  itemID = "";
  /** EmailAddress slots which hold X.500 addresses (RoutingType "EX", e.g. contacts from the GAL).
   * We cannot display them, but we must not delete them from the server either. */
  protected exchangeEmailKeys = new Set<string>();

  fromXML(xmljs: any) {
    this.itemID = sanitize.nonemptystring(xmljs.ItemId?.Id, "");
    this.name = sanitize.nonemptystring(xmljs.DisplayName, "");
    this.firstName = sanitize.nonemptystring(xmljs.GivenName, "");
    this.lastName = sanitize.nonemptystring(xmljs.Surname, "");
    // When the last entry was deleted, the whole dictionary is missing,
    // so clear our values in that case, too.
    this.exchangeEmailKeys = new Set(ensureArray(xmljs.EmailAddresses?.Entry)
      .filter(entry => entry.RoutingType && entry.RoutingType != "SMTP")
      .map(entry => entry.Key));
    this.emailAddresses.replaceAll(ensureArray(xmljs.EmailAddresses?.Entry)
      .filter(entry => entry.Value && (!entry.RoutingType || entry.RoutingType == "SMTP"))
      .map(entry => new ContactEntry(sanitize.emailAddress(entry.Value, null), "work", "mailto"))
      .filter(ce => ce.value));
    let phoneNumbers = new ArrayColl<ContactEntry>();
    for (let entry of ensureArray(xmljs.PhoneNumbers?.Entry)) {
      let value = sanitize.nonemptystring(entry.Value, null);
      switch (value && entry.Key) { // Key may have other unsupported values
      case "HomePhone":
      case "HomePhone2":
        phoneNumbers.add(new ContactEntry(value, "home", "tel"));
        break;
      case "BusinessPhone":
      case "BusinessPhone2":
        phoneNumbers.add(new ContactEntry(value, "work", "tel"));
        break;
      case "HomeFax":
        phoneNumbers.add(new ContactEntry(value, "home", "fax"));
        break;
      case "BusinessFax":
        phoneNumbers.add(new ContactEntry(value, "work", "fax"));
        break;
      case "OtherFax":
        phoneNumbers.add(new ContactEntry(value, "other", "fax"));
        break;
      case "MobilePhone":
        phoneNumbers.add(new ContactEntry(value, "mobile", "tel"));
        break;
      case "OtherTelephone":
        phoneNumbers.add(new ContactEntry(value, "other", "tel"));
        break;
      }
    }
    this.phoneNumbers.replaceAll(phoneNumbers);
    this.chatAccounts.replaceAll(ensureArray(xmljs.ImAddresses?.Entry).filter(entry => entry.Value).map(entry => new ContactEntry(sanitize.nonemptystring(entry.Value), "other")));
    this.streetAddresses.replaceAll(ensureArray(xmljs.PhysicalAddresses?.Entry).map(entry =>
      new ContactEntry(EWSPerson.ewsToStreetAddress(entry).toString(), PhysicalAddressPurposes[entry.Key])));
    this.notes = sanitize.nonemptystring(xmljs.Body?.Value, "");
    this.company = sanitize.nonemptystring(xmljs.CompanyName, "");
    this.department = sanitize.nonemptystring(xmljs.Department, "");
    this.position = sanitize.nonemptystring(xmljs.JobTitle, "");
    this.pictureChangedOnServer(ensureArray(xmljs.Attachments?.FileAttachment));
  }

  protected static ewsToStreetAddress(entry: any): StreetAddress {
    let streetAddress = new StreetAddress();
    for (let ourProp in PhysicalAddressElements) {
      let ewsProp = PhysicalAddressElements[ourProp];
      streetAddress[ourProp] = sanitize.nonemptystring(entry[ewsProp], null);
    }
    return streetAddress;
  }

  async saveToServer() {
    let request = this.itemID ? new EWSUpdateItemRequest(this.itemID) : new EWSCreateItemRequest({ m$SavedItemFolderId: { t$FolderId: { Id: this.addressbook.folderID } } });
    // `null`, not `""`, so that empty notes result in a field deletion, not an invalid empty <t:Body/>
    request.addField("Contact", "Body", this.notes ? { BodyType: "Text", _TextContent_: this.notes } : null, "item:Body");
    request.addField("Contact", "DisplayName", this.name, "contacts:DisplayName");
    request.addField("Contact", "GivenName", this.firstName, "contacts:GivenName");
    request.addField("Contact", "CompanyName", this.company, "contacts:CompanyName");
    let emailEntries = this.emailAddresses.contents.slice();
    for (let i = 1; i <= 3; i++) {
      if (this.exchangeEmailKeys.has("EmailAddress" + i)) {
        continue;
      }
      let entry = emailEntries.shift();
      request.addField("Contact", "EmailAddresses", entry && {
        t$Entry: {
          Key: "EmailAddress" + i,
          _TextContent_: entry.value,
        },
      }, "contacts:EmailAddress", "EmailAddress" + i);
    }
    for (let key in PhysicalAddressPurposes) {
      let entry = this.streetAddresses.find(entry => entry.purpose == PhysicalAddressPurposes[key]);
      let streetAddress = new StreetAddress(entry?.value);
      for (let ourProp in PhysicalAddressElements) {
        let ewsProp = PhysicalAddressElements[ourProp];
        let value = streetAddress[ourProp];
        request.addField("Contact", "PhysicalAddresses", value ? {
          t$Entry: {
            Key: key,
            ["t$" + ewsProp]: value,
          },
        } : null, "contacts:PhysicalAddress:" + ewsProp, key);
      }
    }
    for (let [purpose, protocol, count, key] of PhoneMapping) {
      let values = this.phoneNumbers.contents.filter(entry => entry.purpose == purpose && (entry.protocol || "tel") == protocol).map(entry => entry.value);
      for (let i = 0; i < count; i++) {
        request.addField("Contact", "PhoneNumbers", values[i] && {
          t$Entry: {
            Key: key,
            _TextContent_: values[i],
          },
        }, "contacts:PhoneNumber", key);
        key += "2";
      }
    }
    request.addField("Contact", "Department", this.department, "contacts:Department");
    for (let i = 1; i <= 3; i++) {
      let entry = this.chatAccounts.getIndex(i - 1);
      request.addField("Contact", "ImAddresses", entry && {
        t$Entry: {
          Key: "ImAddress" + i,
          _TextContent_: entry.value,
        },
      }, "contacts:ImAddress", "ImAddress" + i);
    }
    request.addField("Contact", "JobTitle", this.position, "contacts:JobTitle");
    request.addField("Contact", "Surname", this.lastName, "contacts:Surname");
    // console.log("EWSPerson.save()", request);
    let response = await this.addressbook.account.callEWS(request);
    this.itemID = sanitize.nonemptystring(response.Items.Contact.ItemId.Id);
    await this.savePictureToServer();
  }

  /** Exchange saves the picture as an attachment of the contact,
   * so it needs separate calls, after the contact exists on the server. */
  protected async savePictureToServer() {
    if (!this.pictureChanged) {
      return;
    }
    if (this.pictureAttachmentID) {
      await this.addressbook.account.callEWS({
        m$DeleteAttachment: {
          m$AttachmentIds: {
            t$AttachmentId: {
              Id: this.pictureAttachmentID,
            },
          },
        },
      });
      this.pictureAttachmentID = "";
    }
    if (this.picture) {
      let picture = await dataURLToBlob(this.picture);
      let response = await this.addressbook.account.callEWS({
        m$CreateAttachment: {
          m$ParentItemId: {
            Id: this.itemID,
          },
          m$Attachments: {
            t$FileAttachment: {
              t$Name: kPictureFilename,
              t$ContentType: picture.type,
              t$IsContactPhoto: true,
              t$Content: await blobToBase64(picture),
            },
          },
        },
      });
      this.pictureAttachmentID = sanitize.nonemptystring(response.Attachments.FileAttachment.AttachmentId.Id, "");
    }
    this.pictureOnServer = this.picture;
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
    this.pictureAttachmentID = sanitize.string(json.pictureAttachmentID, "");
  }

  toExtraJSON(): any {
    let json = super.toExtraJSON();
    json.itemID = this.itemID;
    json.pictureAttachmentID = this.pictureAttachmentID;
    return json;
  }
}

const PhysicalAddressElements: Record<string, string> = {
  street: "Street",
  city: "City",
  postalCode: "PostalCode",
  state: "State",
  country: "CountryOrRegion",
};
const PhysicalAddressPurposes: Record<string, string> = {
  Business: "work",
  Home: "home",
  Other: "other",
};
const PhoneMapping: [string, string, number, string][] = [
  ["home", "tel", 2, "HomePhone"],
  ["work", "tel", 2, "BusinessPhone"],
  ["home", "fax", 1, "HomeFax"],
  ["work", "fax", 1, "BusinessFax"],
  ["other", "fax", 1, "OtherFax"],
  ["other", "tel", 1, "OtherTelephone"],
  ["mobile", "tel", 1, "MobilePhone"],
];
