// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { JMAPAccount } from "../../../../logic/Mail/JMAP/JMAPAccount";
import { JMAPAddressbook } from "../../../../logic/Contacts/JMAP/JMAPAddressbook";
import type { TJMAPSession } from "../../../../logic/Mail/JMAP/TJMAPGeneric";
import { afterEach, beforeAll, expect, test } from "vitest";

beforeAll(() => {
  appGlobal.remoteApp ??= {
    kyCreate: () => { throw new Error("The test should not talk to a real server"); },
  } as any;
  JMAPAddressbook.prototype.save = async () => {}; // no database
  JMAPAddressbook.prototype.syncOnStartup = async () => {};
});

afterEach(() => {
  appGlobal.addressbooks.clear();
});

const kCapabilities = { "urn:ietf:params:jmap:contacts": {}, "urn:ietf:params:jmap:principals": {} };
const kSession = {
  capabilities: { "urn:ietf:params:jmap:core": {}, "urn:ietf:params:jmap:contacts": {}, "urn:ietf:params:jmap:principals": {} },
  primaryAccounts: { "urn:ietf:params:jmap:principals": "t" },
  accounts: {
    t: { name: "bob@example.com", isPersonal: true, isReadOnly: false, accountCapabilities: kCapabilities },
    s: { name: "alice@example.com", isPersonal: false, isReadOnly: false, accountCapabilities: kCapabilities },
  },
} as any as TJMAPSession;

/** As Stalwart sends it to Bob, when Alice shares her "Team" address book with him */
const kNotification = {
  id: "jkbilqy093aa", name: "", created: "2026-10-18T01:58:12Z",
  changedBy: { principalId: "s", name: "alice", email: "alice@example.com" },
  objectAccountId: "s", objectId: "c", objectType: "AddressBook",
  oldRights: { mayRead: false, mayWrite: false, mayDelete: false, mayShare: false },
  newRights: { mayRead: true, mayWrite: false, mayDelete: false, mayShare: false },
};

test("An address book that Alice shares later, when we have her account already, shows up", async () => {
  let bob = new JMAPAccount();
  bob.accountID = "t";
  bob.session = kSession;
  bob.save = async () => {};
  bob.getSession = async () => {};
  bob.syncState.set("ShareNotification", "n1");
  bob.makeCombinedCall = async () => ({
    changes: { accountId: "t", oldState: "n1", newState: "n2", hasMoreChanges: false, created: [kNotification.id], updated: [], destroyed: [] },
    new: { accountId: "t", state: "n2", list: [kNotification], notFound: [] },
  });
  let alice = new JMAPAccount();
  alice.initFromMainAccount(bob);
  alice.accountID = "s";
  alice.session = kSession;
  alice.makeSingleCall = async (method: string, args: any) => {
    if (method != "AddressBook/get") {
      return { accountId: "s", state: "x", list: [], notFound: [], updated: {} };
    }
    return {
      accountId: "s", state: "a2", notFound: [], list: [{
        id: "c", name: "Team", description: null, sortOrder: 0, isDefault: false, isSubscribed: true, shareWith: null,
        myRights: { mayRead: true, mayWrite: false, mayDelete: false, mayShare: false },
      }],
    };
  };
  appGlobal.emailAccounts.add(alice);

  await bob.addNewlySharedAccounts();

  let aliceAddressbooks = appGlobal.addressbooks.contents.filter(ab => ab.mainAccount == alice);
  expect(aliceAddressbooks.map(ab => ab.name)).toEqual(["Team"]);
  appGlobal.emailAccounts.remove(alice);
});
