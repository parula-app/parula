// FileReader, which we use to read the picture file
// @vitest-environment happy-dom

// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../../logic/app";
import { OWAAddressbook } from "../../../../logic/Contacts/OWA/OWAAddressbook";
import { OWAAccount } from "../../../../logic/Mail/OWA/OWAAccount";
import { DummyAddressbookStorage } from "../../../../logic/Contacts/SQL/DummyAddressbookStorage";
import type { Person } from "../../../../logic/Abstract/Person";
import { beforeEach, expect, test } from "vitest";

/** A picture that the user picked from a file, here a 1x1 PNG */
const kPictureBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGP4DwABAQEANl9ngAAAAABJRU5ErkJggg==";
const kFilePicture = "data:image/png;base64," + kPictureBase64;
/** The same picture, as Exchange returns it */
const kServerPicture = "data:image/jpeg;base64," + kPictureBase64;
const kPersonaID = "contact-persona";
const kItemID = "contact-item";
const kAttachmentID = "picture-attachment";
/** The server gives each contact its own attachment */
const kPictureAttachmentID = kItemID + "-" + kAttachmentID;
const kNewAttachmentID = "new-picture-attachment";

/** A contact in our address book, as OWA returns it */
function personaJSON(personaID = kPersonaID, itemID = kItemID): any {
  return {
    PersonaId: { Id: personaID },
    DisplayName: "Alice Example",
    GivenName: "Alice",
    Surname: "Example",
    EmailAddresses: [{ EmailAddress: "alice@example.com" }],
    AttributionsArray: [{
      Id: "0",
      SourceId: { Id: itemID },
      DisplayName: "Outlook",
      IsWritable: true,
    }],
  };
}

/** Answers like Exchange does, and remembers the requests */
function fakeAccount(pictureAttachmentID?: string, ...personas: any[]): any {
  if (!personas.length) {
    personas = [personaJSON()];
  }
  return {
    errorCallback: (ex: Error) => { throw ex; },
    itemsFromResponses: OWAAccount.prototype.itemsFromResponses,
    requests: [] as any[],
    async callOWA(request: any) {
      this.requests.push(request);
      switch (request.action) {
      case "FindPeople":
        return { ResultSet: personas };
      case "GetPersona":
        return { Persona: personas.find(persona => persona.PersonaId.Id == request.Body.PersonaId.Id) };
      case "GetNotesForPersona":
        return {};
      case "GetItem":
        return unwrap(request.Body.ItemIds.map(itemID => ({
          ResponseClass: "Success",
          Items: [{
            ItemId: { Id: itemID.Id },
            Attachments: pictureAttachmentID ? [{
              AttachmentId: { Id: itemID.Id + "-" + pictureAttachmentID },
              Name: "ContactPicture.jpg",
              ContentType: "image/jpeg",
              IsContactPhoto: true,
              Size: 70,
            }] : undefined,
          }],
        })));
      case "GetAttachment":
        return unwrap(request.Body.AttachmentIds.map(attachmentID => ({
          ResponseClass: "Success",
          Attachments: [{
            AttachmentId: { Id: attachmentID.Id },
            Name: "ContactPicture.jpg",
            ContentType: "image/jpeg",
            Content: pictureOf(attachmentID.Id),
          }],
        })));
      case "CreateAttachment":
        return { Attachments: [{ AttachmentId: { Id: kNewAttachmentID } }] };
      case "DeleteAttachment":
        return {};
      default: // CreatePersona, UpdatePersona
        return { PersonaId: { Id: kPersonaID }, DisplayName: "Alice Example" };
      }
    },
  };
}

/** `OWAAccount.callOWAShared()` hands us a single response message unwrapped */
function unwrap(responses: any[]): any {
  return responses.length == 1 ? responses[0] : { ResponseMessages: { Items: responses } };
}

/** Each attachment holds a different picture, so that we notice a mix-up */
function pictureOf(attachmentID: string): string {
  return attachmentID == kPictureAttachmentID ? kPictureBase64 : btoa(attachmentID);
}

/** Counts the saves, which are expensive: they rewrite all contact entries */
class CountingStorage extends DummyAddressbookStorage {
  readonly saved: Person[] = [];
  async savePerson(person: Person): Promise<void> {
    this.saved.push(person);
  }
}

let addressbook: OWAAddressbook;
let storage: CountingStorage;

function newAddressbook(pictureAttachmentID?: string, ...personas: any[]): OWAAddressbook {
  let addressbook = new OWAAddressbook();
  addressbook.mainAccount = fakeAccount(pictureAttachmentID, ...personas);
  addressbook.storage = storage = new CountingStorage();
  addressbook.folderID = "contacts-folder";
  return addressbook;
}

function requestsOfAction(action: string): any[] {
  return (addressbook.account as any).requests.filter(request => request.action == action);
}

beforeEach(() => {
  addressbook = newAddressbook(kAttachmentID);
});

test("reads the picture of the contact", async () => {
  await addressbook.listPersons([personaJSON()]);

  let person = addressbook.persons.first;
  expect(person.name).toBe("Alice Example");
  expect(person.itemID).toBe(kItemID);
  expect(person.pictureAttachmentID).toBe(kPictureAttachmentID);
  expect(person.picture).toBe(kServerPicture);
});

test("finds the contact of a persona without attributions", async () => {
  let persona = personaJSON();
  delete persona.AttributionsArray;
  persona.EmailAddress = { EmailAddress: "alice@example.com", ItemId: { Id: kItemID } };
  addressbook = newAddressbook(kAttachmentID, persona);

  await addressbook.listPersons([persona]);

  let person = addressbook.persons.first;
  expect(person.itemID).toBe(kItemID);
  expect(person.picture).toBe(kServerPicture);
});

test("fetches the pictures of the whole batch in one call", async () => {
  let personas = [
    personaJSON("persona-1", "contact-1"),
    personaJSON("persona-2", "contact-2"),
    personaJSON("persona-3", "contact-3"),
  ];
  addressbook = newAddressbook(kAttachmentID, ...personas);

  await addressbook.listPersons(personas);

  expect(requestsOfAction("GetItem").length).toBe(1);
  expect(requestsOfAction("GetAttachment").length).toBe(1);
  let persons = addressbook.persons.contents;
  // Each person got its own picture
  expect(persons[0].picture).toBe("data:image/jpeg;base64," + btoa("contact-1-" + kAttachmentID));
  expect(persons[2].picture).toBe("data:image/jpeg;base64," + btoa("contact-3-" + kAttachmentID));
  // Each person is saved on the listing, and again when its picture arrives
  expect(storage.saved.length).toBe(6);
});

test("downloads the picture only when it changed", async () => {
  await addressbook.listPersons([personaJSON()]);

  // Next sync
  await addressbook.listPersons([personaJSON()]);

  expect(addressbook.persons.first.picture).toBe(kServerPicture);
  expect(requestsOfAction("GetAttachment").length).toBe(1);
});

test("removes the picture that the server deleted", async () => {
  await addressbook.listPersons([personaJSON()]);
  let person = addressbook.persons.first;

  addressbook.mainAccount = fakeAccount(); // The user deleted the picture in OWA
  await addressbook.listPersons([personaJSON()]);

  expect(person.picture).toBe(null);
  expect(person.pictureAttachmentID).toBe("");
});

test("saves a new picture as attachment of the contact", async () => {
  addressbook = newAddressbook();
  let person = addressbook.newPerson();
  person.name = "Alice Example";
  person.picture = kFilePicture;

  await person.saveToServer();

  let creates = requestsOfAction("CreateAttachment");
  expect(creates.length).toBe(1);
  let attachment = creates[0].Body.Attachments[0];
  expect(creates[0].Body.ParentItemId.Id).toBe(kItemID);
  expect(attachment.IsContactPhoto).toBe(true);
  expect(attachment.Name).toBe("ContactPicture.jpg");
  expect(attachment.ContentType).toBe("image/png");
  expect(attachment.Content).toBe(kPictureBase64);
  expect(person.pictureAttachmentID).toBe(kNewAttachmentID);
});

test("uploads the picture only when the user changed it", async () => {
  await addressbook.listPersons([personaJSON()]);
  let person = addressbook.persons.first;

  person.name = "Alice Sample";
  await person.saveToServer();

  expect(requestsOfAction("CreateAttachment").length).toBe(0);
  expect(requestsOfAction("DeleteAttachment").length).toBe(0);
});

test("replaces the old picture on the server", async () => {
  await addressbook.listPersons([personaJSON()]);
  let person = addressbook.persons.first;

  person.picture = kFilePicture;
  await person.saveToServer();

  let deletes = requestsOfAction("DeleteAttachment");
  expect(deletes.length).toBe(1);
  expect(deletes[0].Body.AttachmentIds[0].Id).toBe(kPictureAttachmentID);
  expect(requestsOfAction("CreateAttachment").length).toBe(1);
  expect(person.pictureAttachmentID).toBe(kNewAttachmentID);
});

test("deletes the picture on the server", async () => {
  await addressbook.listPersons([personaJSON()]);
  let person = addressbook.persons.first;

  person.picture = null;
  await person.saveToServer();

  expect(requestsOfAction("DeleteAttachment").length).toBe(1);
  expect(requestsOfAction("CreateAttachment").length).toBe(0);
  expect(person.pictureAttachmentID).toBe("");
});
