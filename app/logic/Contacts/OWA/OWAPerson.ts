import { ExchangePerson, kPictureFilename } from "../EWS/ExchangePerson";
import { ContactEntry } from '../../Abstract/Person';
import { Attachment } from '../../Abstract/Attachment';
import { StreetAddress } from '../StreetAddress';
import type { OWAAddressbook } from './OWAAddressbook';
import { OWACreatePersonaRequest } from "./Request/OWACreatePersonaRequest";
import { OWADeletePersonaRequest } from "./Request/OWADeletePersonaRequest";
import { OWAUpdatePersonaRequest } from "./Request/OWAUpdatePersonaRequest";
import { owaGetPersonaRequest } from "./Request/OWAPersonRequests";
import { owaCreateAttachmentRequest, owaDeleteAttachmentsRequest } from "../../Mail/OWA/Request/OWAAttachmentRequests";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { assert } from "../../util/util";
import { blobToBase64, dataURLToBlob } from "../../util/blob";
import { gt } from "../../../l10n/l10n";

export class OWAPerson extends ExchangePerson {
  declare addressbook: OWAAddressbook | null;
  fields: Record<string, string> = this.toFields();

  /** The Exchange PersonaId,
   * or the empty string if the item has not been saved to the server. */
  personaID = "";
  /** The ItemId of the contact behind the persona.
   * The picture hangs off the contact, not off the persona. */
  itemID = "";

  fromJSON(json: any): OWAPerson {
    this.personaID = sanitize.nonemptystring(json.PersonaId?.Id);
    this.itemID = OWAPerson.itemIDFromJSON(json);
    this.name = sanitize.nonemptystring(json.DisplayName, "");
    this.firstName = sanitize.nonemptystring(json.GivenName, "");
    this.lastName = sanitize.nonemptystring(json.Surname, "");
    this.emailAddresses.replaceAll(json.EmailAddresses
      ?.filter(address => !address.RoutingType || address.RoutingType == "SMTP")
      .map(address =>
        new ContactEntry(sanitize.emailAddress(address.EmailAddress, null), "work", "mailto")
      ).filter(ce => ce.value) || []);
    this.phoneNumbers.replaceAll(PhoneMapping.flatMap(([purpose, protocol, ...keys]) =>
      keys.map(key => json[key + "Array"]?.[0]?.Value?.Number)
      .filter(Boolean).map(number =>
        new ContactEntry(sanitize.string(number), purpose, protocol))));
    this.chatAccounts.replaceAll(json.ImAddress ? [
      new ContactEntry(sanitize.string(json.ImAddress), "other")
    ] : []);
    this.streetAddresses.replaceAll(Object.keys(PhysicalAddressPurposes)
      .flatMap(purpose => json[purpose + "AddressesArray"]
        ?.filter(entry => entry?.Value)
        .map(entry =>
          new ContactEntry(OWAPerson.owaToStreetAddress(entry.Value),
            PhysicalAddressPurposes[purpose])
      ) || []));
    this.notes = sanitize.nonemptystring(json.Notes, "");
    this.company = sanitize.nonemptystring(json.CompanyName, "");
    this.department = sanitize.nonemptystring(json.Department, "");
    this.position = sanitize.nonemptystring(json.Title, "");
    this.fields = this.toFields();
    return this;
  }

  /** The persona is an aggregate, e.g. of a GAL entry and our contact.
   * The writable attribution is the contact in our mailbox.
   * Fall back to the email address, which knows the contact as well,
   * @see `OWAAddressbook.listGroups()` */
  protected static itemIDFromJSON(json: any): string {
    let contact = json.AttributionsArray?.find(attribution => sanitize.boolean(attribution.IsWritable, false) && attribution.SourceId);
    return sanitize.nonemptystring(contact?.SourceId.Id ?? json.EmailAddress?.ItemId?.Id, "");
  }

  protected static owaToStreetAddress(json: any): string {
    // console.log("owa to street address", json);
    let address = new StreetAddress();
    for (let ourProp in PhysicalAddressElements) {
      let owaProp = PhysicalAddressElements[ourProp];
      address[ourProp] = sanitize.nonemptystring(json[owaProp], "");
    }
    // console.log("owa to street address", json, address.toJSON());
    return address.toString();
  }

  async saveToServer() {
    let fields = this.toFields();
    if (Object.keys(fields).some(key => fields[key] != this.fields[key])) {
      let request = this.personaID ? new OWAUpdatePersonaRequest(this.personaID, this.fields, fields) : new OWACreatePersonaRequest(this.addressbook.folderID, this.fields, fields);
      let response = await this.addressbook.callOWA(request);
      this.name = sanitize.nonemptystring(response.DisplayName, "");
      this.personaID = sanitize.nonemptystring(response.PersonaId.Id);
      this.itemID = OWAPerson.itemIDFromJSON(response);
      this.fields = fields;
    }
    await this.savePictureToServer();
  }

  /** Exchange saves the picture as an attachment of the contact,
   * which the persona calls do not touch,
   * so it needs separate calls, after the contact exists on the server. */
  protected async savePictureToServer() {
    if (!this.pictureChanged) {
      return;
    }
    if (!this.itemID) {
      // This probably shouldn't happen, since we sync the itemID on login.
      let response = await this.addressbook.callOWA(owaGetPersonaRequest(this.personaID));
      this.itemID = OWAPerson.itemIDFromJSON(response.Persona);
    }
    assert(this.itemID, gt`Cannot find the contact ${this.name} on the server`);
    if (this.pictureAttachmentID) {
      await this.addressbook.callOWA(owaDeleteAttachmentsRequest([this.pictureAttachmentID]));
      this.pictureAttachmentID = "";
    }
    if (this.picture) {
      let blob = await dataURLToBlob(this.picture);
      let picture = new Attachment();
      picture.fromFile(new File([blob], kPictureFilename, { type: blob.type }));
      let request = owaCreateAttachmentRequest(this.itemID, picture);
      request.Body.Attachments[0].IsContactPhoto = true;
      let response;
      if (this.addressbook.account.authorizationHeader) {
        response = await this.addressbook.callOWAWithOffice365Attachment(request, picture);
      } else {
        request.Body.Attachments[0].Content = await blobToBase64(picture.content);
        response = await this.addressbook.callOWA(request);
      }
      this.pictureAttachmentID = sanitize.nonemptystring(response.Attachments[0].AttachmentId.Id, "");
    }
    this.pictureOnServer = this.picture;
  }

  protected toFields(): Record<string, string> {
    let fields: Record<string, string> = {};
    // fields.PersonaDisplayName = this.name;
    fields.PersonaGivenNames = this.firstName;
    fields.PersonaSurnames = this.lastName;
    for (let i = 1; i <= 3; i++) {
      let value = this.emailAddresses.getIndex(i - 1)?.value || "";
      fields[`PersonaEmails${i}OriginalDisplayNames`] = fields[`PersonaEmails${i}`] = value;
    }
    for (let [purpose, protocol, ...keys] of PhoneMapping) {
      let values = this.phoneNumbers.contents.filter(entry => entry.purpose == purpose && (entry.protocol || "tel") == protocol).map(entry => entry.value);
      for (let i = 0; i < keys.length; i++) {
        fields["Persona" + keys[i]] = values[i] || "";
      }
    }
    fields.PersonaImAddresses = this.chatAccounts.getIndex(0)?.value || "";
    fields.PersonaTitles = this.position || "";
    fields.PersonaDepartments = this.department || "";
    fields.PersonaCompanyNames = this.company || "";
    // TODO "Addresses" (plural): We can have multiple "work" etc. addresses each
    fields.PersonaBusinessAddresses = OWAPerson.streetAddressToOWA(this.streetAddresses.find(entry => entry.purpose == "work")?.value);
    fields.PersonaHomeAddresses = OWAPerson.streetAddressToOWA(this.streetAddresses.find(entry => entry.purpose == "home")?.value);
    fields.PersonaOtherAddresses = OWAPerson.streetAddressToOWA(this.streetAddresses.find(entry => entry.purpose == "other")?.value);
    fields.PersonaBodies = this.notes;
    // console.log("OWAPerson save()", fields);
    return fields;
  }

  protected static streetAddressToOWA(str: string): string {
    if (!str) {
      return "$#$$#$$#$$#$";
    }
    let address = new StreetAddress(str);
    let values = [ address.street, address.city, address.state, address.postalCode, address.country ];
    return values.map(value => value ?? "").join("$#$");
  }

  async deleteFromServer() {
    if (!this.personaID) {
      // Not saved to the server, e.g. because the save failed
      return;
    }
    let request = new OWADeletePersonaRequest(this.personaID);
    await this.addressbook.callOWA(request);
    this.addressbook.persons.remove(this);
  }

  fromExtraJSON(json: any) {
    super.fromExtraJSON(json);
    // Old existing contacts saved the personaID in the id
    this.personaID = sanitize.string(json.personaID, this.id);
    this.itemID = sanitize.string(json.itemID, "");
    this.pictureAttachmentID = sanitize.string(json.pictureAttachmentID, "");
  }

  toExtraJSON(): any {
    let json = super.toExtraJSON();
    json.personaID = this.personaID;
    json.itemID = this.itemID;
    json.pictureAttachmentID = this.pictureAttachmentID;
    return json;
  }
}

const PhysicalAddressElements: Record<string, string> = {
  street: "Street",
  city: "City",
  state: "State",
  postalCode: "PostalCode",
  country: "Country",
};
const PhysicalAddressPurposes: Record<string, string> = {
  Business: "work",
  Home: "home",
  Other: "other",
};
const PhoneMapping: [string, string, string, string?][] = [
  ["work", "tel", "BusinessPhoneNumbers", "BusinessPhoneNumbers2"],
  ["home", "tel", "HomePhones", "HomePhones2"],
  ["mobile", "tel", "MobilePhones", "CarPhones"],
  ["other", "tel", "OtherTelephones"],
  ["work", "fax", "WorkFaxes"],
  ["home", "fax", "HomeFaxes"],
  ["other", "fax", "OtherFaxes"],
];
