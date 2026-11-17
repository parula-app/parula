import { ExchangeAddressbook } from "../EWS/ExchangeAddressbook";
import { AddressbookShareCombinedPermissions } from "../Addressbook";
import type { PersonUID } from "../../Abstract/PersonUID";
import type { Attachment } from "../../Abstract/Attachment";
import { OWAPerson } from "./OWAPerson";
import { OWAGroup } from "./OWAGroup";
import { type OWAAccount, kMaxFetchCount } from "../../Mail/OWA/OWAAccount";
import { owaGetPermissionsRequest, owaSetFolderPermissionsRequest } from "../../Mail/OWA/Request/OWAFolderRequests";
import { owaGetAttachmentsRequest } from "../../Mail/OWA/Request/OWAAttachmentRequests";
import { owaFindPersonsRequest, owaGetContactAttachmentsRequest, owaGetPersonaRequest } from "./Request/OWAPersonRequests";
import { getSharedPersons, ExchangePermission, deleteExchangePermissions, setExchangePermissions } from "../../Mail/EWS/ExchangePermission";
import { RunOnce } from "../../util/flow/RunOnce";
import { sanitize } from "../../../../lib/util/sanitizeDatatypes";
import { assert } from "../../util/util";
import { gt } from "../../../l10n/l10n";
import type { ArrayColl } from "svelte-collections";

export class OWAAddressbook extends ExchangeAddressbook {
  readonly protocol: string = "addressbook-owa";
  /** Exchange FolderID for this addressbook. Not DistinguishedFolderId */
  folderID: string;
  declare readonly persons: ArrayColl<OWAPerson>;
  declare readonly groups: ArrayColl<OWAGroup>;
  protected listContactsRunOnce = new RunOnce();

  get account(): OWAAccount {
    assert(this.mainAccount, gt`Address book ${this.name} lost the connection to its account`);
    return this.mainAccount as OWAAccount;
  }

  callOWA(aRequest: any) {
    return this.username == this.account.username
      ? this.account.callOWA(aRequest)
      : this.account.callOWA(aRequest, this.username);
  }

  callOWAWithOffice365Attachment(aRequest: any, attachment: Attachment) {
    return this.username == this.account.username
      ? this.account.callOWAWithOffice365Attachment(aRequest, attachment)
      : this.account.callOWAWithOffice365Attachment(aRequest, attachment, this.username);
  }

  newPerson(): OWAPerson {
    return new OWAPerson(this);
  }
  newGroup(): OWAGroup {
    return new OWAGroup(this);
  }

  get isLoggedIn(): boolean {
    return this.account.isLoggedIn;
  }

  async listContacts() {
    await super.listContacts();
    await this.listContactsRunOnce.runOnce(() => this.listContactsSlow());
  }

  async listContactsSlow() {
    if (!this.dbID) {
      await this.save();
    }

    let persons = [];
    let groups = [];
    let request = owaFindPersonsRequest(this.folderID, kMaxFetchCount);
    let response;
    do {
      response = await this.callOWA(request);
      for (let result of response.ResultSet) {
        if (result.EmailAddress?.EmailAddress) {
          persons.push(result);
        } else if (result.PersonaTypeString == "DistributionList") {
          groups.push(result);
        } else {
          persons.push(result);
        }
      }
      request.Body.IndexedPageItemView.Offset += kMaxFetchCount;
    } while (response.ResultSet.length == kMaxFetchCount);
    await this.listPersons(persons);
    await this.listGroups(groups);
  }

  async listPersons(persons: any[]) {
    for (let person of this.persons.contents.filter(person => person.personaID && !persons.some(result => result.PersonaId.Id == person.personaID))) {
      this.persons.remove(person);
      await person.deleteLocally();
    }
    for (let result of persons) {
      try {
        let request = owaGetPersonaRequest(result.PersonaId.Id);
        let response = await this.callOWA(request);
        Object.assign(result, response.Persona);
        let requestNotes = new OWAGetNotesForPersonaRequest(result.PersonaId.Id);
        let responseNotes = await this.callOWA(requestNotes);
        result.Notes = responseNotes.PersonaWithNotes?.BodiesArray[0].Value.Value;
        let person = this.getPersonByPersonaID(result.PersonaId.Id) ?? this.newPerson();
        person.fromJSON(result);
        await person.saveLocally();
      } catch (ex) {
        this.account.errorCallback(ex);
      }
    }
    // The pictures are slow and not vital, so they come only after all contacts
    await this.downloadPictures(this.persons.contents);
  }

  /** Exchange saves the pictures as attachments of the contacts,
   * which the personas do not include, so they need 2 extra calls,
   * but a whole batch of contacts fits in each call.
   * Downloads only the pictures that changed, @see `ExchangePerson.needsPicture` */
  async downloadPictures(persons: OWAPerson[]) {
    let contacts = persons.filter(person => person.itemID);
    for (let i = 0; i < contacts.length; i += kMaxFetchCount) {
      let batch = contacts.slice(i, i + kMaxFetchCount);
      try {
        // Which attachment of each contact is the picture, and did it change?
        let response = await this.callOWA(owaGetContactAttachmentsRequest(batch.map(person => person.itemID)));
        let items = response.ResponseMessages ? this.account.itemsFromResponses(response.ResponseMessages.Items) : response.Items;
        for (let item of items) {
          let itemID = sanitize.nonemptystring(item.ItemId.Id);
          let person = batch.find(person => person.itemID == itemID);
          if (person?.pictureChangedOnServer(item.Attachments ?? []) && !person.needsPicture) {
            await person.saveLocally(); // the picture disappeared from the server
          }
        }
        let needPicture = batch.filter(person => person.needsPicture);
        if (!needPicture.length) {
          continue;
        }
        response = await this.callOWA(owaGetAttachmentsRequest(needPicture.map(person => person.pictureAttachmentID)));
        let attachments = response.ResponseMessages ? this.account.itemsFromResponses(response.ResponseMessages.Items, "Attachments") : response.Attachments;
        for (let attachment of attachments) {
          let attachmentID = sanitize.nonemptystring(attachment.AttachmentId.Id);
          let person = needPicture.find(person => person.pictureAttachmentID == attachmentID);
          if (person) {
            person.pictureFromServer(sanitize.nonemptystring(attachment.Content), sanitize.nonemptystring(attachment.ContentType, ""));
            await person.saveLocally();
          }
        }
      } catch (ex) {
        this.account.errorCallback(ex);
      }
    }
  }

  async listGroups(groups: any[]) {
    for (let group of this.groups.contents.filter(group => group.personaID && !groups.some(result => result.PersonaId.Id == group.personaID))) {
      this.groups.remove(group);
      // The server deleted the list, so delete it only locally.
      await group.deleteLocally();
    }
    for (let result of groups) {
      try {
        let request: any = new OWAGetGroupInfoRequest(result.EmailAddress.ItemId.Id);
        let response = await this.callOWA(request);
        result.Members = response.Members;
        request = new OWAGetNotesForPersonaRequest(result.PersonaId.Id);
        response = await this.callOWA(request);
        result.Notes = response.PersonaWithNotes?.BodiesArray[0].Value.Value;
        let group = this.getGroupByPersonaID(result.PersonaId.Id);
        if (group) {
          group.fromJSON(result);
          await group.saveLocally();
        } else {
          group = this.newGroup();
          group.fromJSON(result);
          await group.saveLocally();
          this.groups.add(group);
        }
      } catch (ex) {
        this.account.errorCallback(ex);
      }
    }
  }

  getPersonByPersonaID(id: string): OWAPerson | undefined {
    return this.persons.find(p => p.personaID == id);
  }

  getGroupByPersonaID(id: string): OWAGroup | undefined {
    return this.groups.find(p => p.personaID == id);
  }

  async getSharedPersons(): Promise<ArrayColl<PersonUID>> {
    let result = await this.account.callOWA(owaGetPermissionsRequest(this.folderID));
    return getSharedPersons(result.Folders[0].PermissionSet.Permissions, this.account.emailAddress);
  }

  async deleteSharedPerson(otherPerson: PersonUID) {
    await deleteExchangePermissions(this, otherPerson);
  }

  get sharePermissionLevels(): AddressbookShareCombinedPermissions[] {
    return [AddressbookShareCombinedPermissions.Read, AddressbookShareCombinedPermissions.Modify];
  }

  async addSharedPerson(otherPerson: PersonUID, access: AddressbookShareCombinedPermissions) {
    await setExchangePermissions(this, otherPerson, access);
  }

  async getPermissions(): Promise<ExchangePermission[]> {
    let result = await this.account.callOWA(owaGetPermissionsRequest(this.folderID));
    return result.Folders[0].PermissionSet.Permissions.map(permission => new ExchangePermission(permission));
  }

  async setPermissions(permissions: ExchangePermission[]) {
    await this.account.callOWA(owaSetFolderPermissionsRequest(this.folderID, permissions));
  }

  fromConfigJSON(json: any) {
    super.fromConfigJSON(json);
    this.folderID = sanitize.string(json.folderID, null);
  }
  toConfigJSON(): any {
    let json = super.toConfigJSON();
    json.folderID = this.folderID;
    return json;
  }
}

class OWAGetNotesForPersonaRequest {
  /** This is what would normally be the body of a request */
  readonly getNotesForPersonaRequest: any = {
    __type: "GetNotesForPersonaRequest:#Exchange",
    MaxBytesToFetch: 512000,
  };

  constructor(id: string) {
    this.getNotesForPersonaRequest.PersonaId = id;
  }

  get action() {
    return "GetNotesForPersona";
  }
}

class OWAGetGroupInfoRequest {
  /** This is what would normally be the body of a request */
  readonly getGroupInfoRequest: any = {
    __type: "GetGroupInfoRequest:#Exchange",
    ItemId: {
      __type: "ItemId:#Exchange",
    },
    Paging: {
      __type: "IndexedPageView:#Exchange",
      BasePoint: "Beginning",
      MaxEntriesReturned: kMaxFetchCount,
      Offset: 0,
    },
    ParentFolderId: {
      __type: "TargetFolderId:#Exchange",
      BaseFolderId: null,
    },
    ResultSet: 2,
  };

  constructor(id: string) {
    this.getGroupInfoRequest.ItemId.Id = id;
  }

  get action() {
    return "GetGroupInfo";
  }
}
