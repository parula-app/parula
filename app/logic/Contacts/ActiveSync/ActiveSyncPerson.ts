import { ExchangePerson } from '../EWS/ExchangePerson';
import { ContactEntry } from '../../Abstract/Person';
import { StreetAddress } from '../StreetAddress';
import type { ActiveSyncAddressbook } from './ActiveSyncAddressbook';
import { ActiveSyncError } from "../../Mail/ActiveSync/ActiveSyncError";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { blobToBase64, dataURLToBlob } from "../../util/blob";
import { parseOneAddress, type ParsedMailbox } from "email-addresses";

export class ActiveSyncPerson extends ExchangePerson {
  declare addressbook: ActiveSyncAddressbook | null;

  /** The ActiveSync ServerId,
   * or the empty string if the item has not been saved to the server. */
  serverID = "";

  fromWBXML(wbxmljs: any) {
    this.firstName = sanitize.nonemptystring(wbxmljs.FirstName, "");
    this.lastName = sanitize.nonemptystring(wbxmljs.LastName, "");
    if (wbxmljs.DisplayName) { // only for GAL search results
      this.name = sanitize.nonemptylabel(wbxmljs.DisplayName);
    } else {
      this.name = sanitize.nonemptylabel(this.firstName ? this.lastName ? `${this.firstName} ${this.lastName}` : this.firstName : this.lastName, null) ??
        sanitize.nonemptystring(wbxmljs.FileAs, ""); // e.g. company-only contact
    }
    this.emailAddresses.replaceAll([wbxmljs.Email1Address, wbxmljs.Email2Address, wbxmljs.Email3Address]
      .filter(Boolean)
      .map(address => new ContactEntry(sanitize.emailAddress((parseOneAddress(address) as ParsedMailbox)?.address, null), "work", "mailto"))
      .filter(ce => ce.value));
    this.phoneNumbers.replaceAll(PhoneMapping.flatMap(([purpose, protocol, count]) => ["", "2"].slice(0, count).map(index => wbxmljs[`${ContactElements[purpose]}${index}${ContactElements[protocol]}Number`]).filter(Boolean).map(value => new ContactEntry(sanitize.string(value), purpose, protocol))));
    this.chatAccounts.replaceAll([wbxmljs.IMAddress, wbxmljs.IMAddress2, wbxmljs.IMAddress3].filter(Boolean).map(address => new ContactEntry(sanitize.string(address), "other")));
    this.streetAddresses.replaceAll(["home", "work", "other"]
      .map(purpose => ActiveSyncPerson.fromWBXMLToStreetAddress(wbxmljs, purpose))
      .filter(ce => !!ce));
    this.notes = sanitize.nonemptystring(wbxmljs.Body?.Data, "");
    this.company = sanitize.nonemptystring(wbxmljs.CompanyName, "");
    this.department = sanitize.nonemptystring(wbxmljs.Department, "");
    this.position = sanitize.nonemptystring(wbxmljs.JobTitle, "");
    if (wbxmljs.Picture) {
      this.pictureFromServer(sanitize.nonemptystring(wbxmljs.Picture));
    } else {
      this.picture = null;
      this.pictureOnServer = null;
    }
  }

  protected static fromWBXMLToStreetAddress(wbxmljs: Record<string, any>, purpose: string): ContactEntry | null {
    let address = new StreetAddress();
    let haveValue = false;
    for (let ourProp in PhysicalAddressElements) {
      let asProp = PhysicalAddressElements[ourProp];
      address[ourProp] = sanitize.string(wbxmljs[`${ContactElements[purpose]}Address${asProp}`], null);
      if (address[ourProp]) {
        haveValue = true;
      }
    }
    return haveValue ? new ContactEntry(address.toString(), purpose) : null;
  }

  async saveToServer() {
    let fields: Record<string, any> = {
      FirstName: this.firstName,
      LastName: this.lastName,
      Body: {
        Type: "1",
        Data: this.notes || {}, // Special case for empty notes
      },
      JobTitle: this.position || "",
      Department: this.department || "",
      CompanyName: this.company || "",
    }
    // ActiveSync sends the picture inline, unlike EWS and OWA.
    // The picture is one of the few elements that the server keeps when we omit it,
    // so send it only when the user changed it, and spare us the upload.
    if (this.pictureChanged) {
      fields.Picture = this.picture ? await blobToBase64(await dataURLToBlob(this.picture)) : {};
    }
    // Always send every slot. An empty element deletes the value,
    // whereas in ActiveSync 16.x, an omitted element would keep it.
    for (let i = 0; i < 3; i++) {
      fields[`Email${i + 1}Address`] = this.emailAddresses.getIndex(i)?.value || {};
    }
    for (let [purpose, protocol, count] of PhoneMapping) {
      let values = this.phoneNumbers.contents.filter(entry => entry.purpose == purpose && (entry.protocol || "tel") == protocol).map(entry => entry.value);
      for (let i = 0; i < count; i++) {
        fields[`${ContactElements[purpose]}${"2".slice(0, i)}${ContactElements[protocol]}Number`] = values[i] || {};
      }
    }
    for (let i = 0; i < 3; i++) {
      fields[`IMAddress${i ? i + 1 : ""}`] = this.chatAccounts.getIndex(i)?.value || {};
    }
    for (let purpose of ["home", "work", "other"]) {
      ActiveSyncPerson.streetAddressToActiveSync(this.streetAddresses.find(entry => entry.purpose == purpose)?.value, purpose, fields);
    }
    let data = this.serverID ? {
      GetChanges: "0",
      Commands: {
        Change: {
          ServerId: this.serverID,
          ApplicationData: fields,
        },
      },
    } : {
      GetChanges: "0",
      Commands: {
        Add: {
          ClientId: await this.addressbook.account.nextClientID(),
          ApplicationData: fields,
        },
      },
    };
    let response = await this.addressbook.makeSyncRequest(data);
    if (response.Responses) {
      if (response.Responses.Change) {
        throw new ActiveSyncError("Sync", response.Responses.Change.Status, this.addressbook);
      }
      if (response.Responses.Add) {
        if (response.Responses.Add.Status != "1") {
          throw new ActiveSyncError("Sync", response.Responses.Add.Status, this.addressbook);
        }
        this.serverID = sanitize.nonemptystring(response.Responses.Add.ServerId);
      }
    }
    this.pictureOnServer = this.picture;
  }

  protected static streetAddressToActiveSync(str: string | undefined, purpose: string, fields: Record<string, any>) {
    let address = new StreetAddress(str);
    for (let ourProp in PhysicalAddressElements) {
      let asProp = PhysicalAddressElements[ourProp];
      fields[`${ContactElements[purpose]}Address${asProp}`] = address[ourProp] || {};
    }
  }

  async deleteFromServer() {
    if (!this.serverID) {
      // Not saved to the server, e.g. because the save failed
      return;
    }
    let data = {
      DeletesAsMoves: "0",
      GetChanges: "0",
      Commands: {
        Delete: {
          ServerId: this.serverID,
        },
      },
    };
    let response = await this.addressbook.makeSyncRequest(data);
    if (response.Responses) {
      throw new ActiveSyncError("Sync", response.Responses.Delete.Status, this.addressbook);
    }
  }

  fromExtraJSON(json: any) {
    super.fromExtraJSON(json);
    // Old existing contacts saved the serverID in the id
    this.serverID = sanitize.string(json.serverID, this.id);
  }

  toExtraJSON(): any {
    let json = super.toExtraJSON();
    json.serverID = this.serverID;
    return json;
  }
}

const PhysicalAddressElements: Record<string, string> = {
  street: "Street",
  city: "City",
  postalCode: "PostalCode",
  state: "State",
  country: "Country",
};
const PhoneMapping: [string, string, number][] = [
  ["home", "tel", 2],
  ["work", "tel", 2],
  ["home", "fax", 1],
  ["work", "fax", 1],
  ["mobile", "tel", 1],
];
const ContactElements: Record<string, string> = {
  home: "Home",
  work: "Business",
  other: "Other",
  mobile: "Mobile",
  tel: "Phone",
  fax: "Fax",
};
