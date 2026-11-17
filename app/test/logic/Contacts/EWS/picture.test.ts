// FileReader, which we use to read the picture file
// @vitest-environment happy-dom

// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../../logic/app";
import { EWSAddressbook } from "../../../../logic/Contacts/EWS/EWSAddressbook";
import { EWSPerson } from "../../../../logic/Contacts/EWS/EWSPerson";
import { DummyAddressbookStorage } from "../../../../logic/Contacts/SQL/DummyAddressbookStorage";
import type { Person } from "../../../../logic/Abstract/Person";
import { beforeEach, expect, test } from "vitest";

/** A picture that the user picked from a file, here a 1x1 PNG */
const kPictureBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGP4DwABAQEANl9ngAAAAABJRU5ErkJggg==";
const kFilePicture = "data:image/png;base64," + kPictureBase64;
/** The same picture, as Exchange returns it */
const kServerPicture = "data:image/jpeg;base64," + kPictureBase64;
const kItemID = "contact-item";
const kAttachmentID = "picture-attachment";
const kNewAttachmentID = "new-picture-attachment";

/** Counts the saves, which are expensive: they rewrite all contact entries */
class CountingStorage extends DummyAddressbookStorage {
  readonly saved: Person[] = [];
  async savePerson(person: Person): Promise<void> {
    this.saved.push(person);
  }
}

/** Answers like Exchange does, and remembers the requests.
 * Returns a single response message as such, and several as an array,
 * just like `EWSAccount.checkResponse()` does. */
function fakeAccount(contacts: any[]): any {
  return {
    errorCallback: (ex: Error) => { throw ex; },
    requests: [] as any[],
    async callEWS(request: any) {
      this.requests.push(request);
      if (request.m$GetItem) {
        return unwrap(ensure(request.m$GetItem.m$ItemIds.t$ItemId).map(itemID => ({
          Items: { Contact: contacts.find(contact => contact.ItemId.Id == itemID.Id) },
        })));
      }
      if (request.m$GetAttachment) {
        return unwrap(ensure(request.m$GetAttachment.m$AttachmentIds.t$AttachmentId).map(attachmentID => ({
          Attachments: {
            FileAttachment: {
              AttachmentId: { Id: attachmentID.Id },
              Name: "ContactPicture.jpg",
              ContentType: "image/jpeg",
              IsContactPhoto: "true",
              Content: pictureOf(attachmentID.Id),
            },
          },
        })));
      }
      if (request.m$CreateAttachment) {
        return { Attachments: { FileAttachment: { AttachmentId: { Id: kNewAttachmentID } } } };
      }
      if (request.m$DeleteAttachment) {
        return {};
      }
      return { Items: { Contact: { ItemId: { Id: kItemID } } } };
    },
  };
}

function ensure(value: any): any[] {
  return Array.isArray(value) ? value : [value];
}

function unwrap(responses: any[]): any {
  return responses.length == 1 ? responses[0] : responses;
}

/** Each attachment holds a different picture, so that we notice a mix-up */
function pictureOf(attachmentID: string): string {
  return attachmentID == kAttachmentID ? kPictureBase64 : btoa(attachmentID);
}

/** A contact, as `XML2JSON()` returns it */
function contactXML(itemID = kItemID, pictureAttachmentID?: string): any {
  let contact: any = {
    ItemId: { Id: itemID },
    DisplayName: "Alice Example",
    GivenName: "Alice",
    Surname: "Example",
  };
  if (pictureAttachmentID) {
    contact.Attachments = {
      FileAttachment: {
        AttachmentId: { Id: pictureAttachmentID },
        Name: "ContactPicture.jpg",
        ContentType: "image/jpeg",
        IsContactPhoto: "true",
        Size: "70",
      },
    };
  }
  return contact;
}

let addressbook: EWSAddressbook;
let storage: CountingStorage;

function newAddressbook(contacts: any[]): EWSAddressbook {
  let addressbook = new EWSAddressbook();
  addressbook.mainAccount = fakeAccount(contacts);
  addressbook.storage = storage = new CountingStorage();
  addressbook.folderID = "contacts-folder";
  return addressbook;
}

/** The contact IDs, as `listPersons()` gets them from the sync */
function itemIDs(contacts: any[]): any[] {
  return contacts.map(contact => ({ ItemId: contact.ItemId }));
}

function requestsOfType(type: string): any[] {
  return (addressbook.account as any).requests.filter(request => request[type]);
}

beforeEach(() => {
  addressbook = newAddressbook([contactXML(kItemID, kAttachmentID)]);
});

test("reads the picture of the contact", async () => {
  let contacts = [contactXML(kItemID, kAttachmentID)];
  addressbook = newAddressbook(contacts);

  await addressbook.listPersons(itemIDs(contacts));

  let person = addressbook.persons.first as EWSPerson;
  expect(person.picture).toBe(kServerPicture);
  expect(person.pictureAttachmentID).toBe(kAttachmentID);
});

test("fetches the pictures of the whole batch in one call", async () => {
  let contacts = [
    contactXML("contact-1", "attachment-1"),
    contactXML("contact-2", "attachment-2"),
    contactXML("contact-3"), // has no picture
  ];
  addressbook = newAddressbook(contacts);

  await addressbook.listPersons(itemIDs(contacts));

  expect(requestsOfType("m$GetItem").length).toBe(1);
  expect(requestsOfType("m$GetAttachment").length).toBe(1);
  let persons = addressbook.persons.contents as EWSPerson[];
  // Each person got its own picture
  expect(persons[0].picture).toBe("data:image/jpeg;base64," + btoa("attachment-1"));
  expect(persons[1].picture).toBe("data:image/jpeg;base64," + btoa("attachment-2"));
  expect(persons[2].picture).toBeFalsy();
  // Each person is saved on the listing, and again when its picture arrives
  expect(storage.saved.length).toBe(5);
});

test("downloads the picture only when it changed", async () => {
  let contacts = [contactXML(kItemID, kAttachmentID)];
  addressbook = newAddressbook(contacts);
  await addressbook.listPersons(itemIDs(contacts));

  // Next sync
  await addressbook.listPersons(itemIDs(contacts));

  expect(addressbook.persons.first.picture).toBe(kServerPicture);
  expect(requestsOfType("m$GetAttachment").length).toBe(1);
  expect(addressbook.persons.length).toBe(1);
});

test("removes the picture that the server deleted", async () => {
  let contacts = [contactXML(kItemID, kAttachmentID)];
  addressbook = newAddressbook(contacts);
  await addressbook.listPersons(itemIDs(contacts));
  let person = addressbook.persons.first as EWSPerson;

  contacts[0] = contactXML(kItemID); // The user deleted the picture in Outlook
  await addressbook.listPersons(itemIDs(contacts));

  expect(person.picture).toBe(null);
  expect(person.pictureAttachmentID).toBe("");
});

test("saves a new picture as attachment of the contact", async () => {
  let person = new EWSPerson(addressbook);
  person.name = "Alice Example";
  person.picture = kFilePicture;

  await person.saveToServer();

  expect(person.itemID).toBe(kItemID);
  let creates = requestsOfType("m$CreateAttachment");
  expect(creates.length).toBe(1);
  let attachment = creates[0].m$CreateAttachment.m$Attachments.t$FileAttachment;
  expect(creates[0].m$CreateAttachment.m$ParentItemId.Id).toBe(kItemID);
  expect(attachment.t$IsContactPhoto).toBe(true);
  expect(attachment.t$Name).toBe("ContactPicture.jpg");
  expect(attachment.t$ContentType).toBe("image/png");
  expect(attachment.t$Content).toBe(kPictureBase64);
  expect(person.pictureAttachmentID).toBe(kNewAttachmentID);
});

test("uploads the picture only when the user changed it", async () => {
  let contacts = [contactXML(kItemID, kAttachmentID)];
  addressbook = newAddressbook(contacts);
  await addressbook.listPersons(itemIDs(contacts));
  let person = addressbook.persons.first as EWSPerson;

  person.name = "Alice Sample";
  await person.saveToServer();

  expect(requestsOfType("m$CreateAttachment").length).toBe(0);
  expect(requestsOfType("m$DeleteAttachment").length).toBe(0);
});

test("replaces the old picture on the server", async () => {
  let contacts = [contactXML(kItemID, kAttachmentID)];
  addressbook = newAddressbook(contacts);
  await addressbook.listPersons(itemIDs(contacts));
  let person = addressbook.persons.first as EWSPerson;

  person.picture = kFilePicture;
  await person.saveToServer();

  let deletes = requestsOfType("m$DeleteAttachment");
  expect(deletes.length).toBe(1);
  expect(deletes[0].m$DeleteAttachment.m$AttachmentIds.t$AttachmentId.Id).toBe(kAttachmentID);
  expect(requestsOfType("m$CreateAttachment").length).toBe(1);
  expect(person.pictureAttachmentID).toBe(kNewAttachmentID);
});

test("deletes the picture on the server", async () => {
  let contacts = [contactXML(kItemID, kAttachmentID)];
  addressbook = newAddressbook(contacts);
  await addressbook.listPersons(itemIDs(contacts));
  let person = addressbook.persons.first as EWSPerson;

  person.picture = null;
  await person.saveToServer();

  expect(requestsOfType("m$DeleteAttachment").length).toBe(1);
  expect(requestsOfType("m$CreateAttachment").length).toBe(0);
  expect(person.pictureAttachmentID).toBe("");
});
