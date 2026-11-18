// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { JMAPAccount } from "../../../../logic/Mail/JMAP/JMAPAccount";
import { JMAPCalendar } from "../../../../logic/Calendar/JMAP/JMAPCalendar";
import type { TJMAPCalendar } from "../../../../logic/Calendar/JMAP/TJMAPCalendar";
import { afterEach, beforeAll, expect, test } from "vitest";

beforeAll(() => {
  appGlobal.remoteApp ??= {
    kyCreate: () => { throw new Error("The test should not talk to a real server"); },
  } as any;
  JMAPCalendar.prototype.save = async () => {}; // no database
});

afterEach(() => {
  appGlobal.calendars.clear();
});

const kReadOnly = { mayReadFreeBusy: true, mayReadItems: true, mayWriteAll: false, mayWriteOwn: false, mayUpdatePrivate: false, mayRSVP: false, mayShare: false, mayDelete: false };
const kOwner = { mayReadFreeBusy: true, mayReadItems: true, mayWriteAll: true, mayWriteOwn: true, mayUpdatePrivate: true, mayRSVP: true, mayShare: true, mayDelete: true };

/** Alice's calendars, as Stalwart returns them to Bob, after she shared
 * her default calendar and "Alice Team" with him */
const kSharedWithBob: TJMAPCalendar[] = [
  {
    id: "b", name: "Stalwart Calendar (alice@example.com)", description: null, color: null, sortOrder: 0,
    isSubscribed: false, isVisible: true, isDefault: true, includeInAvailability: "none",
    defaultAlertsWithTime: {}, defaultAlertsWithoutTime: {}, timeZone: null, shareWith: null, myRights: kReadOnly,
  },
  {
    id: "c", name: "Alice Team", description: null, color: "#ff8000", sortOrder: 0,
    isSubscribed: false, isVisible: true, isDefault: false, includeInAvailability: "none",
    defaultAlertsWithTime: {}, defaultAlertsWithoutTime: {}, timeZone: null, shareWith: null, myRights: kReadOnly,
  },
] as any;

/** Our own calendars */
const kOwn: TJMAPCalendar[] = [
  {
    id: "b", name: "Stalwart Calendar (bob@example.com)", description: null, color: null, sortOrder: 0,
    isSubscribed: true, isVisible: true, isDefault: true, includeInAvailability: "all",
    defaultAlertsWithTime: {}, defaultAlertsWithoutTime: {}, timeZone: null, shareWith: {}, myRights: kOwner,
  },
  {
    id: "d", name: "Old stuff", description: null, color: null, sortOrder: 0,
    isSubscribed: false, isVisible: true, isDefault: false, includeInAvailability: "all",
    defaultAlertsWithTime: {}, defaultAlertsWithoutTime: {}, timeZone: null, shareWith: {}, myRights: kOwner,
  },
] as any;

function newAccount(accountID: string, calendars: TJMAPCalendar[], mainAccount?: JMAPAccount): JMAPAccount {
  let account = new JMAPAccount();
  if (mainAccount) {
    account.initFromMainAccount(mainAccount);
  }
  account.accountID = accountID;
  account.makeSingleCall = async (method: string, args: any) => {
    expect(method).toBe("Calendar/get");
    return { accountId: args.accountId, state: "sjq", list: calendars, notFound: [] };
  };
  return account;
}

function calendarIDs(account: JMAPAccount): string[] {
  return appGlobal.calendars.contents
    .filter(cal => cal.mainAccount == account)
    .map(cal => (cal as JMAPCalendar).jmapID)
    .sort();
}

test("Calendars that another user shared with us are shown, also when not subscribed", async () => {
  let bob = newAccount("v", kOwn);
  let alice = newAccount("u", kSharedWithBob, bob);
  await alice.listCalendars();
  expect(calendarIDs(alice)).toEqual(["b", "c"]);
});

test("Our own calendars that we unsubscribed stay hidden", async () => {
  let bob = newAccount("v", kOwn);
  await bob.listCalendars();
  expect(calendarIDs(bob)).toEqual(["b"]);
});
