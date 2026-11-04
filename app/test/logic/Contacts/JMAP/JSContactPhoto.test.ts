import { expect, test } from "vitest";
import { appGlobal } from "../../../../logic/app.ts"; // defeats circular import
import { JMAPPerson } from "../../../../logic/Contacts/JMAP/JMAPPerson";
import { JSContact } from "../../../../logic/Contacts/JMAP/JSContact";
import type { TJSContact } from "../../../../logic/Contacts/JMAP/TJSContact";

const kPhoto = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const kNewPhoto = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

/** Stalwart's JSContact for a vCard with `PHOTO` and `LOGO` */
function serverCard(): TJSContact {
  return {
    "@type": "Card",
    version: "1.0",
    uid: "urn:uuid:7f6c1e2a-1111-4c5e-9d0a-000000000001",
    name: { full: "Erika Mustermann" },
    media: {
      k1: { kind: "logo", uri: "https://example.com/logo.png" },
      k2: { kind: "photo", uri: kPhoto, mediaType: "image/png" },
    },
  } as TJSContact;
}

function photos(jscontact: TJSContact) {
  return Object.values(jscontact.media ?? {}).filter(media => media.kind == "photo");
}

function newPerson(): JMAPPerson {
  return new JMAPPerson(null);
}

test("The photo of a contact from another client", () => {
  let person = newPerson();
  JSContact.toPerson(serverCard(), person);
  expect(person.picture).toBe(kPhoto);
});

test("Changing the photo replaces it, instead of adding a second one", () => {
  let jscontact = serverCard();
  let person = newPerson();
  JSContact.toPerson(jscontact, person);
  person.picture = kNewPhoto;
  JSContact.fromPerson(person, jscontact);
  expect(photos(jscontact).map(photo => photo.uri)).toEqual([kNewPhoto]);
  expect([undefined, "image/png"]).toContain(photos(jscontact)[0].mediaType); // not one that doesn't match the new photo
  expect(jscontact.media.k1).toEqual(serverCard().media.k1);
});

test("Deleting the photo removes it, but not the logo", () => {
  let jscontact = serverCard();
  let person = newPerson();
  JSContact.toPerson(jscontact, person);
  person.picture = null;
  JSContact.fromPerson(person, jscontact);
  expect(photos(jscontact)).toEqual([]);
  expect(jscontact.media.k1).toEqual(serverCard().media.k1);
});

test("A new photo, and saving again", () => {
  let person = newPerson();
  person.picture = kPhoto;
  let jscontact = {} as TJSContact;
  JSContact.fromPerson(person, jscontact);
  JSContact.fromPerson(person, jscontact);
  expect(photos(jscontact).map(photo => photo.uri)).toEqual([kPhoto]);
});

test("Of several photos, the preferred one", () => {
  let jscontact = serverCard();
  jscontact.media.k3 = { kind: "photo", uri: kNewPhoto, pref: 1 };
  let person = newPerson();
  JSContact.toPerson(jscontact, person);
  expect(person.picture).toBe(kNewPhoto);
});
