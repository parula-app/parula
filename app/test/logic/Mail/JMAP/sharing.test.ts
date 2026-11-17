import { appGlobal } from "../../../../logic/app.ts"; // defeats circular import
import { JMAPAccount } from "../../../../logic/Mail/JMAP/JMAPAccount";
import type { TJMAPSession } from "../../../../logic/Mail/JMAP/TJMAPGeneric";
import { MailShareCombinedPermissions, MailShareIndividualPermissions } from "../../../../logic/Mail/Folder";
import { PersonUID } from "../../../../logic/Abstract/PersonUID";
import { expect, test } from "vitest";

appGlobal.remoteApp = { kyCreate: () => null } as any;

// John's own account, Jane's, which she shared with him, and a shared calendar-only room
const kSession = {
  capabilities: {
    "urn:ietf:params:jmap:mail": {},
    "urn:ietf:params:jmap:principals": {},
    "urn:ietf:params:jmap:mail:share": {}, // Stalwart
  },
  primaryAccounts: {
    "urn:ietf:params:jmap:mail": "u1",
    "urn:ietf:params:jmap:principals": "u1",
  },
  accounts: {
    u1: {
      name: "john.doe@example.com", isPersonal: true, isReadOnly: false,
      accountCapabilities: {
        "urn:ietf:params:jmap:mail": {},
        "urn:ietf:params:jmap:calendars": {},
      },
    },
    u2: {
      name: "jane.smith@example.com", isPersonal: false, isReadOnly: false,
      accountCapabilities: {
        "urn:ietf:params:jmap:mail": {},
        "urn:ietf:params:jmap:contacts": {},
      },
    },
    u3: {
      name: "room4b@example.com", isPersonal: false, isReadOnly: true,
      accountCapabilities: {
        "urn:ietf:params:jmap:calendars": {},
      },
    },
  },
} as any as TJMAPSession;

/** Cyrus always announces its own core extension */
function newCyrusAccount(): JMAPAccount {
  let account = newAccount("u1");
  account.session = {
    ...kSession,
    capabilities: {
      "urn:ietf:params:jmap:principals": {},
      "https://cyrusimap.org/ns/jmap/core": {},
    },
  } as any as TJMAPSession;
  return account;
}

function newAccount(accountID: string): JMAPAccount {
  let account = new JMAPAccount();
  account.emailAddress = "john.doe@example.com";
  account.accountID = accountID;
  account.session = kSession;
  return account;
}

test("The session lists the accounts that others shared with us", async () => {
  let account = newAccount("u1");
  let shared = await account.availableSharedAccounts();
  expect(shared.contents.map(person => person.emailAddress))
    .toEqual(["jane.smith@example.com", "room4b@example.com"]);
  expect(account.canShareWithPersons()).toBe(true);
});

test("Only accounts that others shared with us can be added", async () => {
  let account = newAccount("u1");
  const kIDs = ["msgfolderroot", "inbox", "contacts", "calendar"];
  expect(await account.findSharedFolders(new PersonUID("jane.smith@example.com"), kIDs)).toEqual(["msgfolderroot"]);
  expect(await account.findSharedFolders(new PersonUID("john.doe@example.com"), kIDs)).toEqual([]); // Ourselves
  expect(await account.findSharedFolders(new PersonUID("stranger@example.com"), kIDs)).toEqual([]);
});

test("A shared account offers only what its own capabilities list", () => {
  let ours = newAccount("u1");
  expect([ours.haveMail, ours.haveContacts, ours.haveCalendar]).toEqual([true, false, true]);
  let jane = newAccount("u2");
  expect([jane.haveMail, jane.haveContacts, jane.haveCalendar]).toEqual([true, true, false]);
  let room = newAccount("u3");
  expect([room.haveMail, room.haveContacts, room.haveCalendar]).toEqual([false, false, true]);
});

test("An account that is already set up here is not offered again", async () => {
  let account = newAccount("u1");
  let jane = newAccount("u2");
  jane.mainAccount = account;
  appGlobal.emailAccounts.add(jane);
  try {
    let shared = await account.availableSharedAccounts();
    expect(shared.contents.map(person => person.emailAddress)).toEqual(["room4b@example.com"]);
  } finally {
    appGlobal.emailAccounts.remove(jane);
  }
});

test("An account that the session does not name by email address is skipped", async () => {
  let account = newAccount("u1");
  account.session = {
    ...kSession,
    accounts: {
      ...kSession.accounts,
      // Cyrus without virtdomains names accounts by bare user ID
      u4: { name: "bill", isPersonal: false, isReadOnly: false, accountCapabilities: {} },
    },
  } as any as TJMAPSession;
  let shared = await account.availableSharedAccounts();
  expect(shared.contents.map(person => person.emailAddress))
    .toEqual(["jane.smith@example.com", "room4b@example.com"]);
});

test("Only the access levels that the server can grant are offered", () => {
  let stalwart = newAccount("u1");
  expect(stalwart.sharePermissionLevels).toEqual([
    MailShareCombinedPermissions.Read, MailShareCombinedPermissions.FlagChange,
    MailShareCombinedPermissions.Modify, MailShareCombinedPermissions.Custom]);

  let cyrus = newCyrusAccount();
  expect(cyrus.sharePermissionLevels).toEqual([
    MailShareCombinedPermissions.Read, MailShareCombinedPermissions.Modify]);

  // A server that is neither gets the standard rights, not the ones that Cyrus invented
  let other = newAccount("u1");
  other.session = { ...kSession, capabilities: { "urn:ietf:params:jmap:principals": {} } } as any as TJMAPSession;
  expect(other.sharePermissionLevels).toEqual([
    MailShareCombinedPermissions.Read, MailShareCombinedPermissions.FlagChange,
    MailShareCombinedPermissions.Modify, MailShareCombinedPermissions.Custom]);
});

test("Mailbox rights use the vocabulary of the server", () => {
  let stalwart = newAccount("u1");
  expect((stalwart as any).mailShareRights(MailShareCombinedPermissions.Read, []))
    .toMatchObject({ mayReadItems: true, maySetSeen: false, mayAddItems: false, mayDelete: false });
  expect((stalwart as any).mailShareRights(MailShareCombinedPermissions.Modify, []))
    .toMatchObject({ mayReadItems: true, maySetSeen: true, mayAddItems: true, mayRemoveItems: true, mayDelete: true });
  expect((stalwart as any).mailShareRights(MailShareCombinedPermissions.Custom, [MailShareIndividualPermissions.FlagChange]))
    .toMatchObject({ mayReadItems: false, maySetSeen: true, maySetKeywords: true, mayAddItems: false });

  let cyrus = newCyrusAccount();
  expect((cyrus as any).mailShareRights(MailShareCombinedPermissions.Read, []))
    .toEqual({ mayRead: true, mayWrite: false, mayAdmin: false });
  expect((cyrus as any).mailShareRights(MailShareCombinedPermissions.Modify, []))
    .toEqual({ mayRead: true, mayWrite: true, mayAdmin: true });
});

test("The principals account is found, even when the server omits `principals:owner`", () => {
  let stalwart = newAccount("u1");
  expect((stalwart as any).principalsAccountID).toBe("u1");

  let cyrus = newCyrusAccount();
  expect((cyrus as any).principalsAccountID).toBe("u1");

  let withOwner = newAccount("u1");
  withOwner.session = {
    ...kSession,
    primaryAccounts: { "urn:ietf:params:jmap:mail": "u1" },
    accounts: {
      ...kSession.accounts,
      u1: {
        ...kSession.accounts.u1,
        accountCapabilities: {
          ...kSession.accounts.u1.accountCapabilities,
          "urn:ietf:params:jmap:principals:owner": { accountIdForPrincipal: "p1" },
        },
      },
    },
  } as any as TJMAPSession;
  expect((withOwner as any).principalsAccountID).toBe("p1");
});
