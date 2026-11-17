// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { JMAPAccount } from "../../../../logic/Mail/JMAP/JMAPAccount";
import { JMAPAddressbook } from "../../../../logic/Contacts/JMAP/JMAPAddressbook";
import type { TJMAPContact } from "../../../../logic/Contacts/JMAP/JMAPPerson";
import { afterEach, beforeAll, expect, test } from "vitest";

beforeAll(() => {
  appGlobal.remoteApp ??= {
    kyCreate: () => { throw new Error("The test should not talk to a real server"); },
  } as any;
});

afterEach(() => {
  appGlobal.addressbooks.clear();
});

/** More rounds than any real sync needs. A client that goes on longer is stuck. */
const kSaneMaxRounds = 10000;

/** A card as Stalwart returns it, created in the address book "b" by another client */
function stalwartCard(id: string): TJMAPContact {
  return {
    "@type": "Card",
    version: "1.0",
    uid: "urn:uuid:3b1e5a7c-0d2f-4a8e-9b6c-" + id.padStart(12, "0"),
    name: { full: "Person " + id, isOrdered: true },
    id,
    addressBookIds: { b: true },
  } as any as TJMAPContact;
}

/** The server's answer to `ContactCard/changes` since a state */
type TServe = (sinceState: string) => { newState: string, hasMoreChanges: boolean, created: string[] };

/** An account with an address book that was listed before, at the state "s0" */
function setup(serve: TServe) {
  let account = new JMAPAccount();
  account.accountID = "c";
  account.save = async () => {};
  account.login = async () => {};
  let errors: Error[] = [];
  account.errorCallback = ex => errors.push(ex);
  account.syncState.set("ContactCard", "s0");
  let addressbook = new JMAPAddressbook();
  addressbook.initFromMainAccount(account);
  addressbook.jmapID = "b";
  addressbook.storage = { savePerson: async () => {}, saveAddressbook: async () => {} } as any;
  addressbook.readContactsFromDB = async () => {};
  addressbook.errorCallback = ex => errors.push(ex);
  addressbook.syncState = "s0";
  let calls = 0;
  account.makeCombinedCall = async (requests: [string, Record<string, any>, string?][]) => {
    calls++;
    let sinceState = requests[0][1].sinceState;
    let { newState, hasMoreChanges, created } = serve(sinceState);
    return {
      changes: { accountId: "c", oldState: sinceState, newState, hasMoreChanges, created, updated: [], destroyed: [] },
      added: { accountId: "c", state: newState, list: created.map(id => stalwartCard(id)), notFound: [] },
      changed: { accountId: "c", state: newState, list: [], notFound: [] },
    };
  };
  appGlobal.addressbooks.add(addressbook);
  return { account, addressbook, errors, calls: () => calls };
}

/** `count` cards were added since "s0", and the server reports at most `perCall` changes per call.
 * The state "s<n>" is after the first n of them. */
function addedInSteps(count: number, perCall: number): TServe {
  return sinceState => {
    let from = parseInt(sinceState.substring(1));
    let to = Math.min(from + perCall, count);
    return {
      newState: "s" + to,
      hasMoreChanges: to < count,
      created: Array.from({ length: to - from }, (_, i) => String(from + i + 1)),
    };
  };
}

test("All new contacts show up when the server reports the changes in several steps", async () => {
  let { account, addressbook, errors } = setup(addedInSteps(7, 3));

  await addressbook.listContacts();

  expect(addressbook.persons.contents.map(person => person.name).sort())
    .toEqual(["1", "2", "3", "4", "5", "6", "7"].map(id => "Person " + id));
  expect(account.syncState.get("ContactCard")).toBe("s7");
  expect(errors).toEqual([]);
});

test("The sync stops when the server keeps reporting more changes, but no new state", async () => {
  let { account, addressbook, errors, calls } = setup(() => ({ newState: "s1", hasMoreChanges: true, created: ["1"] }));

  await account.sync("ContactCard", "s2"); // what a push does

  expect(calls()).toBeLessThan(10);
  expect(errors.length).toBe(1);
  expect(addressbook.persons.contents.map(person => person.name)).toEqual(["Person 1"]);
});

test("The sync stops after a maximum number of rounds, when the server always reports more changes", async () => {
  let { account, errors, calls } = setup(addedInSteps(Infinity, 1));

  await account.sync("ContactCard", "s2");

  expect(calls()).toBeLessThanOrEqual(kSaneMaxRounds);
  expect(errors.length).toBe(1);
});
