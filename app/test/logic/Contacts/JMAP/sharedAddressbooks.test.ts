// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { JMAPAccount } from "../../../../logic/Mail/JMAP/JMAPAccount";
import { JMAPAddressbook } from "../../../../logic/Contacts/JMAP/JMAPAddressbook";
import type { TJMAPAddressbook } from "../../../../logic/Contacts/JMAP/TJMAPAddressbook";
import { afterEach, beforeAll, expect, test } from "vitest";

beforeAll(() => {
  appGlobal.remoteApp ??= {
    kyCreate: () => { throw new Error("The test should not talk to a real server"); },
  } as any;
  JMAPAddressbook.prototype.save = async () => {}; // no database
});

afterEach(() => {
  appGlobal.addressbooks.clear();
});

/** Alice's address books, as Stalwart returns them to Bob, after she shared
 * her default address book and "Team" with him, but not "Private" */
const kSharedWithBob: TJMAPAddressbook[] = [
  {
    id: "b", name: "Stalwart Address Book (alice@example.com)", description: null, sortOrder: 0,
    isDefault: true, isSubscribed: false, shareWith: null,
    myRights: { mayRead: true, mayWrite: false, mayDelete: false, mayShare: false },
  },
  {
    id: "c", name: "Team", description: null, sortOrder: 0,
    isDefault: false, isSubscribed: false, shareWith: null,
    myRights: { mayRead: true, mayWrite: false, mayDelete: false, mayShare: false },
  },
] as any;

/** Our own address books */
const kOwn: TJMAPAddressbook[] = [
  {
    id: "b", name: "Stalwart Address Book (bob@example.com)", description: null, sortOrder: 0,
    isDefault: true, isSubscribed: true, shareWith: {},
    myRights: { mayRead: true, mayWrite: true, mayDelete: true, mayShare: true },
  },
  {
    id: "d", name: "Old stuff", description: null, sortOrder: 0,
    isDefault: false, isSubscribed: false, shareWith: {},
    myRights: { mayRead: true, mayWrite: true, mayDelete: true, mayShare: true },
  },
] as any;

function newAccount(accountID: string, addressbooks: TJMAPAddressbook[], mainAccount?: JMAPAccount): JMAPAccount {
  let account = new JMAPAccount();
  if (mainAccount) {
    account.initFromMainAccount(mainAccount);
  }
  account.accountID = accountID;
  account.makeSingleCall = async (method: string, args: any) => {
    if (method == "AddressBook/set") { // e.g. to subscribe
      return { accountId: args.accountId, oldState: "a1", newState: "a2", updated: Object.fromEntries(Object.keys(args.update ?? {}).map(id => [id, null])) };
    }
    return { accountId: args.accountId, state: "a1", list: addressbooks, notFound: [] };
  };
  return account;
}

function addressbookIDs(account: JMAPAccount): string[] {
  return appGlobal.addressbooks.contents
    .filter(ab => ab.mainAccount == account)
    .map(ab => (ab as JMAPAddressbook).jmapID);
}

test("Address books that another user shared with us are shown, also when not subscribed", async () => {
  let bob = newAccount("t", kOwn);
  let alice = newAccount("s", kSharedWithBob, bob);
  await alice.listAddressbooks();
  expect(addressbookIDs(alice).sort()).toEqual(["b", "c"]);
});

test("Our own address books that we unsubscribed stay hidden", async () => {
  let bob = newAccount("t", kOwn);
  await bob.listAddressbooks();
  expect(addressbookIDs(bob)).toEqual(["b"]);
});
