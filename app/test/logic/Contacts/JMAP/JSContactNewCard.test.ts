// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { JMAPAccount } from "../../../../logic/Mail/JMAP/JMAPAccount";
import { JMAPAddressbook } from "../../../../logic/Contacts/JMAP/JMAPAddressbook";
import type { TJMAPContact } from "../../../../logic/Contacts/JMAP/TJSContact";
import { beforeAll, expect, test } from "vitest";

beforeAll(() => {
  appGlobal.remoteApp ??= {
    kyCreate: () => { throw new Error("The test should not talk to a real server"); },
  } as any;
});

function setup() {
  let account = new JMAPAccount();
  account.accountID = "a";
  let addressbook = new JMAPAddressbook();
  addressbook.initFromMainAccount(account);
  addressbook.jmapID = "b";
  addressbook.storage = { savePerson: async () => {} } as any;
  let sent: Record<string, any>[] = [];
  account.makeSingleCall = async (method: string, args: Record<string, any>) => {
    sent.push(args);
    return args.create
      ? { created: { [Object.keys(args.create)[0]]: { id: "newCardID" } } }
      : { updated: { [Object.keys(args.update)[0]]: null } };
  };
  return { addressbook, sent };
}

test("A new card is a complete JSContact Card", async () => {
  let { addressbook, sent } = setup();
  let person = addressbook.newPerson();
  person.name = "New Contact";
  addressbook.persons.add(person);
  await person.saveToServer();

  let card = sent[0].create[person.id] as TJMAPContact;
  expect(card["@type"]).toBe("Card");
  expect(card.version).toBe("1.0");
  expect(card.uid).toMatch(/^urn:uuid:[0-9a-f-]{36}$/i);
  // UTCDateTime, RFC 8620 section 1.4
  expect(card.created).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/);
  expect(card.updated ?? card.created).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/);
  expect(person.uid).toBe(card.uid);
});

test("An update sets `updated`, and keeps `created`", async () => {
  let { addressbook, sent } = setup();
  let person = addressbook.newPerson();
  person.fromJMAP({
    "@type": "Card", version: "1.0", uid: "server-uid", created: "2022-09-30T14:35:10Z",
    name: { full: "Jane Doe" }, id: "cardID", addressBookIds: { b: true },
  } as any as TJMAPContact);
  addressbook.persons.add(person);
  person.name = "Jane Doe-Smith";
  await person.saveToServer();

  let update = sent[0].update.cardID;
  expect(update.created ?? "unchanged").toMatch(/^(2022-09-30T14:35:10Z|unchanged)$/); // sent as a whole, or as a patch
  expect(update.updated).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/);
  expect(update.updated).not.toBe("2022-09-30T14:35:10Z");
});
