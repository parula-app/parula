import { appGlobal } from "../../../../logic/app.ts"; // defeats circular import
import { OWAAccount } from "../../../../logic/Mail/OWA/OWAAccount";
import type { OWACalendar } from "../../../../logic/Calendar/OWA/OWACalendar";
import { newCalendarForProtocol } from "../../../../logic/Calendar/AccountsList/Calendars";
import { PersonUID } from "../../../../logic/Abstract/PersonUID";
import { Person } from "../../../../logic/Abstract/Person";
import { k1DayMS, k1HourMS } from "../../../../logic/util/date";
import { InProcessSQLiteDatabase } from "../../util/inProcessSQLite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, expect, test } from "vitest";

/* Bob shared his calendar with Alice in Outlook with "Can view titles and locations",
 * Carol with "Can view when I'm busy".
 *
 * <https://learn.microsoft.com/en-us/powershell/module/exchangepowershell/add-mailboxfolderpermission>:
 * These are the calendar roles LimitedDetails ("View availability data with subject and location")
 * and AvailabilityOnly ("View only availability data"). Neither lets Alice open the calendar folder.
 * <https://learn.microsoft.com/en-us/exchange/client-developer/web-service-reference/getuseravailability-operation>:
 * GetUserAvailability "returns the maximum number of calendar details that the requesting client has permission to receive".
 * <https://learn.microsoft.com/en-us/exchange/client-developer/web-service-reference/freebusyviewtype>:
 * With details, the view is `Detailed`, without them `FreeBusy`.
 * <https://learn.microsoft.com/en-us/exchange/client-developer/web-service-reference/timewindow>:
 * "The maximum value for this time period is 42 days." */

const kAlice = "alice@example.com";
const kBob = "bob@example.com";
const kCarol = "carol@example.com";
/** As the sharing settings check them */
const kSharedFolders = ["msgfolderroot", "inbox", "contacts", "calendar"];

const kToday = new Date();
kToday.setHours(0, 0, 0, 0);
function daysFromToday(days: number, hours = 0): Date {
  return new Date(kToday.getTime() + days * k1DayMS + hours * k1HourMS);
}

/** Bob's appointments, as his availability shows them to Alice */
const kBobAppointments = [{
  Subject: "Dentist",
  Location: { DisplayName: "Smile Clinic" },
  FreeBusyType: "Busy",
  Sensitivity: "Normal",
  start: daysFromToday(5, 10),
  end: daysFromToday(5, 11),
}, {
  Subject: "Lawyer",
  Location: { DisplayName: "Downtown" },
  FreeBusyType: "Busy",
  Sensitivity: "Private",
  start: daysFromToday(2, 14),
  end: daysFromToday(2, 15),
}, {
  // Longer than the longest time span that the server answers, so the client has to ask several times
  Subject: "Parental leave",
  Location: null,
  FreeBusyType: "OOF",
  Sensitivity: "Normal",
  start: daysFromToday(20),
  end: daysFromToday(80),
}];

const kMaxTimeSpanMS = 42 * k1DayMS;
let availabilityRequests: { address: string, start: Date, end: Date }[] = [];

function errorResponse(code: string): any {
  return { ResponseClass: "Error", ResponseCode: code, MessageText: code };
}

function toOWATime(date: Date): string {
  return date.toISOString().slice(0, 19); // UTC, as requested in the `TimeZoneContext`
}

function availabilityResponse(address: string, start: Date, end: Date): any {
  availabilityRequests.push({ address, start, end });
  if (end.getTime() - start.getTime() > kMaxTimeSpanMS) {
    return { ResponseMessage: errorResponse("ErrorInvalidTimeInterval") };
  }
  if (address == kCarol) {
    return {
      ResponseMessage: { ResponseClass: "Success" },
      CalendarView: {
        FreeBusyViewType: "FreeBusy",
        Items: [{ Start: toOWATime(daysFromToday(1, 9)), End: toOWATime(daysFromToday(1, 10)), FreeBusyType: "Busy" }],
      },
    };
  }
  if (address != kBob) {
    return { ResponseMessage: errorResponse("ErrorMailRecipientNotFound") };
  }
  return {
    ResponseMessage: { ResponseClass: "Success" },
    CalendarView: {
      FreeBusyViewType: "Detailed",
      Items: kBobAppointments
        .filter(appointment => appointment.start < end && appointment.end > start)
        .map(appointment => ({
          Start: toOWATime(appointment.start),
          End: toOWATime(appointment.end),
          FreeBusyType: appointment.FreeBusyType,
          Subject: appointment.Subject,
          Location: appointment.Location,
          Sensitivity: appointment.Sensitivity,
        })),
    },
  };
}

/** What Exchange answers, when Alice is logged on */
function serve(action: string, request: any): any {
  switch (action) {
    case "GetFolder":
      return { ResponseMessages: { Items: request.Body.FolderIds.map(() => errorResponse("ErrorAccessDenied")) } };
    case "GetUserAvailabilityInternal": {
      let body = request.request.Body;
      let start = new Date(body.FreeBusyViewOptions.TimeWindow.StartTime);
      let end = new Date(body.FreeBusyViewOptions.TimeWindow.EndTime);
      return { Responses: body.MailboxDataArray.map(mailbox => availabilityResponse(mailbox.Email.Address, start, end)) };
    }
  }
  throw new Error("Unexpected request " + action);
}

let account: OWAAccount;
let errors: Error[] = [];

class TestOWAAccount extends OWAAccount {
  constructor() {
    super();
    this.hasLoggedIn = true;
  }
}

beforeAll(() => {
  let tempDir = mkdtempSync(path.join(tmpdir(), "owa-shared-calendar-limited-test-"));
  appGlobal.remoteApp = {
    getSQLiteDatabase: (filename: string) =>
      new InProcessSQLiteDatabase(path.join(tempDir, filename)),
    getFilesDir: async () => tempDir,
    OWA: {},
  } as any;
  appGlobal.me = new Person();
  account = new TestOWAAccount();
  account.name = "Alice";
  account.username = kAlice;
  account.emailAddress = kAlice;
  account.url = "https://outlook.office365.com/owa/";
  account.authorizationHeader = "Bearer alice-token";
  account.errorCallback = ex => errors.push(ex);

  globalThis.fetch = (async (url: string, options: any) => {
    let headers = options.headers;
    let logon = headers["x-owa-explicitlogonuser"];
    let body = logon && logon != kAlice
      ? { ResponseMessages: { Items: [errorResponse("ErrorAccessDenied")] } }
      : serve(headers.Action, JSON.parse(options.body));
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      url,
      headers: { get: () => "application/json; charset=utf-8" },
      text: async () => JSON.stringify({ Body: body }),
    };
  }) as any;
});

test("OWA: Sharing: A colleague's calendar with titles and locations can be added", async () => {
  let bob = new PersonUID(kBob, "Bob Builder");
  expect(await account.findSharedFolders(bob, kSharedFolders)).toEqual(["calendar"]);
  expect(await account.findSharedFolders(bob, ["calendar"])).toEqual(["calendar"]);
});

test("OWA: Sharing: A colleague's calendar with only busy times is not offered as a calendar", async () => {
  expect(await account.findSharedFolders(new PersonUID(kCarol, "Carol"), kSharedFolders)).toEqual([]);
  expect(await account.findSharedFolders(new PersonUID(kCarol, "Carol"), ["calendar"])).toEqual([]);
  expect(await account.findSharedFolders(new PersonUID("dave@example.com"), ["calendar"])).toEqual([]);
  expect(await account.findSharedFolders(new PersonUID(kBob, "Bob Builder"), ["contacts"])).toEqual([]);
});

let calendar: OWACalendar;

test("OWA: Sharing: Add a colleague's calendar with titles and locations", async () => {
  availabilityRequests = [];
  calendar = await account.addSharedCalendar(new PersonUID(kBob, "Bob Builder"));

  expect(errors).toEqual([]);
  expect(appGlobal.calendars.contains(calendar)).toBe(true);
  expect(calendar.dbID).toBeTruthy(); // still there after a restart
  expect(calendar.name).toContain("Bob Builder");
  let events = calendar.events.contents;
  expect(events.map(event => event.title ?? null).sort()).toEqual(["Dentist", "Parental leave", null]);
  let dentist = events.find(event => event.title == "Dentist");
  expect(dentist.location).toBe("Smile Clinic");
  expect(dentist.startTime.getTime()).toBe(kBobAppointments[0].start.getTime());
  expect(dentist.endTime.getTime()).toBe(kBobAppointments[0].end.getTime());
  let privateAppointment = events.find(event => !event.title);
  expect(privateAppointment.location).toBeFalsy();
  expect(privateAppointment.startTime.getTime()).toBe(kBobAppointments[1].start.getTime());

  expect(availabilityRequests.length).toBeGreaterThan(1);
  expect(availabilityRequests.length).toBeLessThan(20);
  for (let request of availabilityRequests) {
    expect(request.address).toBe(kBob);
    expect(request.end.getTime() - request.start.getTime()).toBeLessThanOrEqual(kMaxTimeSpanMS);
  }
});

test("OWA: Shared calendar with titles and locations: Events are read-only", async () => {
  let dentist = calendar.events.find(event => event.title == "Dentist");
  expect(dentist.isReadOnly).toBe(true);
  expect(dentist.isEditable).toBe(false);
  dentist.title = "Changed";
  await expect(dentist.save()).rejects.toThrow("Bob Builder");
  await expect(dentist.deleteIt()).rejects.toThrow("Bob Builder");
  expect(calendar.events.contains(dentist)).toBe(true);
  expect(() => calendar.newEvent()).toThrow("Bob Builder");
});

test("OWA: Shared calendar with titles and locations: Read again after a restart", async () => {
  let restored = newCalendarForProtocol("calendar-owa") as OWACalendar;
  restored.fromConfigJSON(calendar.toConfigJSON());
  restored.mainAccount = account;
  await restored.listEvents();
  expect(restored.events.contents.map(event => event.title ?? null).sort()).toEqual(["Dentist", "Parental leave", null]);
});

test("OWA: Shared calendar with titles and locations: Added only once", async () => {
  let again = await account.addSharedCalendar(new PersonUID(kBob, "Bob Builder"));
  expect(again).toBe(calendar);
});

test("OWA: Shared calendar with only busy times: Not added as calendar", async () => {
  await expect(account.addSharedCalendar(new PersonUID(kCarol, "Carol"))).rejects.toThrow();
  expect(appGlobal.calendars.contents.some(listed => listed.username == kCarol)).toBe(false);
});
