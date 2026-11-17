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
  JMAPCalendar.prototype.deleteIt = async function () { // no database
    appGlobal.calendars.remove(this);
  };
});

afterEach(() => {
  appGlobal.calendars.clear();
});

const kOwner = { mayReadFreeBusy: true, mayReadItems: true, mayWriteAll: true, mayWriteOwn: true, mayUpdatePrivate: true, mayRSVP: true, mayShare: true, mayDelete: true };

/** A calendar as Stalwart returns it in `Calendar/get` */
function calendar(id: string, name: string, isDefault = false): TJMAPCalendar {
  return {
    id, name, description: null, color: null, sortOrder: 0,
    isSubscribed: true, isVisible: true, isDefault, includeInAvailability: "all",
    defaultAlertsWithTime: {}, defaultAlertsWithoutTime: {}, timeZone: null, shareWith: {}, myRights: kOwner,
  } as any;
}

/** An account whose server returns `calendars`, or refuses with `forbidden` when null */
function newAccount(accountID: string, mainAccount?: JMAPAccount) {
  let account = new JMAPAccount();
  if (mainAccount) {
    account.initFromMainAccount(mainAccount);
  }
  account.accountID = accountID;
  let server = { calendars: [] as TJMAPCalendar[] | "forbidden" | "fails" };
  account.makeSingleCall = async (method: string, args: any) => {
    expect(method).toBe("Calendar/get");
    if (server.calendars == "forbidden") {
      // What Stalwart answers when the other user shares no calendar (any more)
      throw Object.assign(new Error("You do not have access to account " + accountID), { code: "forbidden" });
    }
    if (server.calendars == "fails") {
      throw Object.assign(new Error("HTTP POST <http://127.0.0.1:18080/jmap/> failed with 503 Service Unavailable"), { httpCode: 503 });
    }
    return { accountId: args.accountId, state: "s" + Math.random(), list: server.calendars, notFound: [] };
  };
  return { account, server };
}

function calendarNames(account: JMAPAccount): string[] {
  return appGlobal.calendars.contents
    .filter(cal => cal.mainAccount == account)
    .map(cal => cal.name);
}

function calendarIDs(account: JMAPAccount): string[] {
  return appGlobal.calendars.contents
    .filter(cal => cal.mainAccount == account)
    .map(cal => (cal as JMAPCalendar).jmapID)
    .sort();
}

test("A calendar renamed elsewhere is renamed here", async () => {
  let { account, server } = newAccount("u");
  server.calendars = [calendar("b", "Stalwart Calendar (alice@example.com)", true), calendar("c", "Team")];
  await account.listCalendars();

  server.calendars = [calendar("b", "Stalwart Calendar (alice@example.com)", true), calendar("c", "Team Berlin")];
  await account.sync("Calendar", "s2"); // what a push does

  expect(calendarNames(account)).toContain("Team Berlin");
  expect(calendarNames(account)).not.toContain("Team");
});

test("A calendar deleted elsewhere is removed here", async () => {
  let { account, server } = newAccount("u");
  server.calendars = [calendar("b", "Stalwart Calendar (alice@example.com)", true), calendar("c", "Team")];
  await account.listCalendars();
  expect(calendarNames(account).length).toBe(2);

  server.calendars = [calendar("b", "Stalwart Calendar (alice@example.com)", true)];
  await account.sync("Calendar", "s2");

  expect(appGlobal.calendars.contents.map(cal => (cal as JMAPCalendar).jmapID)).toEqual(["b"]);
});

test("A calendar that is no longer shared with us is removed, when the server lists the others", async () => {
  let { account: bob } = newAccount("v");
  let { account: alice, server } = newAccount("u", bob);
  server.calendars = [calendar("b", "Stalwart Calendar (alice@example.com)", true), calendar("c", "Alice Team")];
  await alice.listCalendars();
  expect(calendarIDs(alice)).toEqual(["b", "c"]);

  server.calendars = [calendar("b", "Stalwart Calendar (alice@example.com)", true)];
  await alice.listCalendars();

  expect(calendarIDs(alice)).toEqual(["b"]);
});

test("When the server doesn't list the calendars, ours and their events stay", async () => {
  let { account: bob } = newAccount("v");
  let { account: alice, server } = newAccount("u", bob);
  server.calendars = [calendar("c", "Alice Team")];
  await alice.listCalendars();

  // A refusal or an error is no list of calendars, so it's no reason to delete ours.
  // Whether the listing reports the error or not doesn't matter here.
  for (let answer of ["forbidden", "fails"] as const) {
    server.calendars = answer;
    try {
      await alice.listCalendars();
    } catch (ex) {
      expect(ex).not.toBeInstanceOf(TypeError);
    }
    expect(calendarIDs(alice)).toEqual(["c"]);
  }
});
