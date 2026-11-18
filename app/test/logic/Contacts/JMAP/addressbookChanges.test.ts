// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { JMAPAccount } from "../../../../logic/Mail/JMAP/JMAPAccount";
import { JMAPAddressbook } from "../../../../logic/Contacts/JMAP/JMAPAddressbook";
import type { TJMAPAddressbook } from "../../../../logic/Contacts/JMAP/TJMAPAddressbook";
import { SQLAddressbookStorage } from "../../../../logic/Contacts/SQL/SQLAddressbookStorage";
import { afterEach, beforeAll, expect, test } from "vitest";

beforeAll(() => {
  appGlobal.remoteApp ??= {
    kyCreate: () => { throw new Error("The test should not talk to a real server"); },
  } as any;
  JMAPAddressbook.prototype.save = async () => {}; // no database
  SQLAddressbookStorage.prototype.deleteAddressbook = async () => {};
});

afterEach(() => {
  appGlobal.addressbooks.clear();
});

/** An address book as Stalwart returns it */
function serverAddressbook(id: string, name: string, isDefault = false): TJMAPAddressbook {
  return {
    id, name, description: null, sortOrder: 0, isDefault, isSubscribed: true, shareWith: {},
    myRights: { mayRead: true, mayWrite: true, mayDelete: true, mayShare: true },
  } as any;
}

let onServer: TJMAPAddressbook[] | "forbidden" | "fails";

/** @param mainAccount Set for another user's account, which they shared with us */
function setup(mainAccount?: JMAPAccount): JMAPAccount {
  let account = new JMAPAccount();
  if (mainAccount) {
    account.initFromMainAccount(mainAccount);
  }
  account.name = "alice@example.com";
  account.accountID = "a";
  account.makeSingleCall = async (method: string, args: any) => {
    if (onServer == "forbidden") {
      // What Stalwart answers when the other user shares no address book (any more)
      throw Object.assign(new Error("You do not have access to account " + args.accountId), { code: "forbidden" });
    }
    if (onServer == "fails") {
      throw Object.assign(new Error("HTTP POST <http://127.0.0.1:18080/jmap/> failed with 503 Service Unavailable"), { httpCode: 503 });
    }
    return { accountId: args.accountId, state: "a1", list: onServer, notFound: [] };
  };
  return account;
}

/** Our address books of this account, as "id: name", in any order */
function addressbooks(account: JMAPAccount): string[] {
  return appGlobal.addressbooks.contents
    .filter(ab => ab.mainAccount == account)
    .map(ab => (ab as JMAPAddressbook).jmapID + ": " + ab.name)
    .sort();
}

test("An address book renamed elsewhere gets the new name", async () => {
  let account = setup();
  onServer = [serverAddressbook("b", "Default", true), serverAddressbook("c", "Team")];
  await account.listAddressbooks();
  onServer = [serverAddressbook("b", "Default", true), serverAddressbook("c", "Team Berlin")];
  await account.listAddressbooks();
  expect(addressbooks(account)).toEqual(["b: alice@example.com", "c: Team Berlin"]);
});

test("An address book deleted elsewhere is removed here", async () => {
  let account = setup();
  onServer = [serverAddressbook("b", "Default", true), serverAddressbook("c", "Team")];
  await account.listAddressbooks();
  onServer = [serverAddressbook("b", "Default", true)];
  await account.listAddressbooks();
  expect(addressbooks(account)).toEqual(["b: alice@example.com"]);
});

test("A new address book is added and listed when the server tells about it", async () => {
  let account = setup();
  onServer = [serverAddressbook("b", "Default", true)];
  await account.listAddressbooks();
  let listed: string[] = [];
  JMAPAddressbook.prototype.syncOnStartup = async function () { listed.push(this.jmapID); };
  onServer = [serverAddressbook("b", "Default", true), serverAddressbook("d", "New")];
  await account.sync("AddressBook", "a2");
  expect(addressbooks(account)).toEqual(["b: alice@example.com", "d: New"]);
  expect(listed).toContain("d");
});

test("An address book that is no longer shared with us is removed, when the server lists the others", async () => {
  let alice = setup(setup());
  onServer = [serverAddressbook("b", "Default", true), serverAddressbook("c", "Team")];
  await alice.listAddressbooks();
  onServer = [serverAddressbook("b", "Default", true)];
  await alice.listAddressbooks();
  expect(addressbooks(alice)).toEqual(["b: alice@example.com"]);
});

test("When the server doesn't list the address books, ours and their contacts stay", async () => {
  let alice = setup(setup());
  onServer = [serverAddressbook("c", "Team")];
  await alice.listAddressbooks();
  let team = appGlobal.addressbooks.contents.find(ab => ab.mainAccount == alice);
  team.persons.add(team.newPerson());

  // A refusal or an error is no list of address books, so it's no reason to delete ours
  onServer = "forbidden";
  await alice.listAddressbooks();
  expect(addressbooks(alice)).toEqual(["c: Team"]);

  onServer = "fails";
  await expect(alice.listAddressbooks()).rejects.toThrow("503");
  expect(addressbooks(alice)).toEqual(["c: Team"]);
  expect(team.persons.length).toBe(1);
});
