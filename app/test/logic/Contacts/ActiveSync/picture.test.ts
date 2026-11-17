// FileReader, which we use to read the picture file
// @vitest-environment happy-dom

// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../../logic/app";
import { ActiveSyncPerson } from "../../../../logic/Contacts/ActiveSync/ActiveSyncPerson";
import { request2WBXML, WBXML2JSON } from "../../../../logic/Mail/ActiveSync/WBXML";
import { expect, test } from "vitest";

/** A picture that the user picked from a file, here a 1x1 PNG */
const kPictureBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGP4DwABAQEANl9ngAAAAABJRU5ErkJggg==";
const kFilePicture = "data:image/png;base64," + kPictureBase64;
/** ActiveSync doesn't say which image format the picture is in, and Exchange uses JPEG */
const kServerPicture = "data:image/jpeg;base64," + kPictureBase64;

/** Sends the sync request to the server and its response back,
 * both through the real WBXML encoding. */
function fakeAddressbook(response: any = {}): any {
  return {
    account: {
      nextClientID: async () => "1",
    },
    sent: null,
    async makeSyncRequest(data: any) {
      let request = {
        Collections: {
          Collection: Object.assign({
            SyncKey: "1",
            CollectionId: "contacts",
          }, data),
        },
      };
      this.sent = await roundtrip({ Sync: request });
      return (await roundtrip({ Sync: { Collections: { Collection: response } } })).Collections.Collection;
    },
  };
}

async function roundtrip(request: any): Promise<any> {
  return WBXML2JSON(new Uint8Array(await request2WBXML(request)));
}

test("reads the picture that the server sent", async () => {
  let addressbook = fakeAddressbook();
  let person = new ActiveSyncPerson(addressbook);

  let sync = await roundtrip({
    Sync: {
      Collections: {
        Collection: {
          Commands: {
            Add: {
              ServerId: "42",
              ApplicationData: {
                FirstName: "Alice",
                LastName: "Example",
                Picture: kPictureBase64,
              },
            },
          },
        },
      },
    },
  });
  person.fromWBXML(sync.Collections.Collection.Commands.Add.ApplicationData);

  expect(person.name).toBe("Alice Example");
  expect(person.picture).toBe(kServerPicture);
});

test("clears the picture that the server deleted", async () => {
  let addressbook = fakeAddressbook();
  let person = new ActiveSyncPerson(addressbook);
  person.picture = kServerPicture;

  person.fromWBXML({ FirstName: "Alice", LastName: "Example" });

  expect(person.picture).toBe(null);
});

test("sends the picture to the server", async () => {
  let addressbook = fakeAddressbook({ Responses: { Add: { Status: "1", ServerId: "42" } } });
  let person = new ActiveSyncPerson(addressbook);
  person.name = "Alice Example";
  person.picture = kFilePicture;

  await person.saveToServer();

  expect(person.serverID).toBe("42");
  expect(addressbook.sent.Collections.Collection.Commands.Add.ApplicationData.Picture).toBe(kPictureBase64);
});

test("deletes the picture on the server", async () => {
  let addressbook = fakeAddressbook();
  let person = new ActiveSyncPerson(addressbook);
  person.serverID = "42";
  person.fromWBXML({ FirstName: "Alice", LastName: "Example", Picture: kPictureBase64 });

  person.picture = null;
  await person.saveToServer();

  // An empty element deletes the picture, an omitted one keeps it
  expect(addressbook.sent.Collections.Collection.Commands.Change.ApplicationData.Picture).toEqual({});
});

test("sends the picture only when the user changed it", async () => {
  let addressbook = fakeAddressbook();
  let person = new ActiveSyncPerson(addressbook);
  person.serverID = "42";
  person.fromWBXML({ FirstName: "Alice", LastName: "Example", Picture: kPictureBase64 });

  person.name = "Alice Sample";
  await person.saveToServer();

  let sent = addressbook.sent.Collections.Collection.Commands.Change.ApplicationData;
  expect(sent.Picture).toBe(undefined);
  expect(sent.LastName).toBe("Sample");
  // The next save doesn't send it again either
  await person.saveToServer();
  expect(addressbook.sent.Collections.Collection.Commands.Change.ApplicationData.Picture).toBe(undefined);
});

test("sends a contact without a picture without the Picture element", async () => {
  let addressbook = fakeAddressbook({ Responses: { Add: { Status: "1", ServerId: "42" } } });
  let person = new ActiveSyncPerson(addressbook);
  person.name = "Alice Example";

  await person.saveToServer();

  expect(addressbook.sent.Collections.Collection.Commands.Add.ApplicationData.Picture).toBe(undefined);
});
