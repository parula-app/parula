// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { JMAPAccount } from "../../../../logic/Mail/JMAP/JMAPAccount";
import { JMAPAddressbook } from "../../../../logic/Contacts/JMAP/JMAPAddressbook";
import type { TJMAPContact } from "../../../../logic/Contacts/JMAP/JMAPPerson";
import { beforeAll, expect, test } from "vitest";

beforeAll(() => {
  appGlobal.remoteApp ??= {
    kyCreate: () => { throw new Error("The test should not talk to a real server"); },
  } as any;
});

/** A contact card, as the server returns it */
function serverCard(): TJMAPContact {
  return {
    "@type": "Card",
    version: "1.0",
    id: "cardID",
    uid: "server-uid",
    name: { full: "Jane Doe" },
    emails: { "0": { address: "jane@example.com" } },
    addressBookIds: { addressbookID: true },
  } as any as TJMAPContact;
}

/** A JMAP address book that records what we send to the server */
function setup() {
  let account = new JMAPAccount();
  account.accountID = "jmapAccount";
  let addressbook = new JMAPAddressbook();
  addressbook.initFromMainAccount(account);
  addressbook.jmapID = "addressbookID";
  addressbook.storage = { savePerson: async () => {} } as any;
  addressbook.errorCallback = ex => { throw ex; };

  let sent: Record<string, any>[] = [];
  account.makeSingleCall = async (method: string, args: Record<string, any>) => {
    sent.push(args);
    return args.create
      ? { created: { [Object.keys(args.create)[0]]: { id: "newCardID" } } }
      : { updated: { [Object.keys(args.update)[0]]: null } };
  };
  return { addressbook, sent };
}

test("An update does not send the UID or the id", async () => {
  // Both are immutable. Our UID can differ from the server's, e.g. when the
  // stored one was lost and `person.id` stood in for it, and the server then
  // refuses every later change to that contact.
  let { addressbook, sent } = setup();
  let person = addressbook.newPerson();
  person.fromJMAP(serverCard());
  addressbook.persons.add(person);

  person.name = "Jane Doe-Smith";
  await person.saveToServer();

  expect(sent[0].update.cardID).not.toHaveProperty("uid");
  expect(sent[0].update.cardID).not.toHaveProperty("id");
  expect(sent[0].update.cardID.name.full).toBe("Jane Doe-Smith");
});

test("A new contact sends its UID", async () => {
  let { addressbook, sent } = setup();
  let person = addressbook.newPerson();
  person.name = "New Contact";
  addressbook.persons.add(person);

  await person.saveToServer();

  expect(sent[0].create[person.id].uid).toBeTruthy();
});
