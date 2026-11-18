import { expect, test } from "vitest";
import { appGlobal } from "../../../../logic/app.ts"; // defeats circular import
import { CardDAVPerson } from "../../../../logic/Contacts/CardDAV/CardDAVPerson";

/** Records the vCards that the contact sends, instead of talking to a CardDAV server */
function fakeAddressbook(sent: string[]): any {
  let response = () => new Response("", { status: 201, headers: { ETag: `"${sent.length}"` } });
  return {
    addressbookURL: "https://dav.example.com/addressbooks/erika/contacts/",
    davAddressbook: {},
    login: async () => {},
    client: {
      createVCard: async ({ vCardString }) => { sent.push(vCardString); return response(); },
      updateVCard: async ({ vCard }) => { sent.push(vCard.data); return response(); },
    },
  };
}

function property(vcf: string, name: string): string | undefined {
  return vcf.replace(/\r\n /g, "").split("\r\n").find(line => line.toUpperCase().startsWith(name + ":"))?.slice(name.length + 1);
}

test("A new contact gets a UUID URN as UID, which stays on later saves", async () => {
  // RFC 6350 6.7.6: UID, e.g. urn:uuid:f81d4fae-7dec-11d0-a765-00a0c91e6bf6
  let sent: string[] = [];
  let person = new CardDAVPerson(fakeAddressbook(sent));
  person.name = "Erika Mustermann";
  await person.saveToServer();
  let uid = property(sent[0], "UID");
  expect(uid).toMatch(/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

  person.notes = "Met at conference.";
  await person.saveToServer();
  expect(property(sent[1], "UID")).toBe(uid);
});

test("Every save sets the revision time", async () => {
  // RFC 6350 6.7.4: REV
  let sent: string[] = [];
  let person = new CardDAVPerson(fakeAddressbook(sent));
  person.name = "Erika Mustermann";
  let before = Date.now();
  await person.saveToServer();
  let rev = property(sent[0], "REV");
  expect(rev).toMatch(/^\d{8}T\d{6}Z$/);
  let time = Date.parse(rev.replace(/^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z$/, "$1-$2-$3T$4:$5:$6Z"));
  expect(time).toBeGreaterThanOrEqual(Math.floor(before / 1000) * 1000);
  expect(time).toBeLessThanOrEqual(Date.now());
});
