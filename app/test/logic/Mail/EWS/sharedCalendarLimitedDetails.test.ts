// @vitest-environment happy-dom
import { appGlobal } from "../../../../logic/app.ts"; // defeats circular import
import { EWSAccount } from "../../../../logic/Mail/EWS/EWSAccount";
import type { EWSCalendar } from "../../../../logic/Calendar/EWS/EWSCalendar";
import { AuthMethod } from "../../../../logic/Abstract/Account";
import { PersonUID } from "../../../../logic/Abstract/PersonUID";
import { Person } from "../../../../logic/Abstract/Person";
import { k1DayMS, k1HourMS } from "../../../../logic/util/date";
import { InProcessSQLiteDatabase } from "../../util/inProcessSQLite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, expect, test } from "vitest";

/* Bob shared his calendar with Alice in Outlook with "Can view titles and locations",
 * Carol with "Can view when I'm busy". Neither lets Alice open the calendar folder.
 * GetUserAvailability returns the appointments with subject and location (`Detailed`)
 * for Bob, and only the busy times (`FreeBusy`) for Carol.
 * See the OWA test of the same name for the documentation. */

const kAlice = "alice@example.com";
const kBob = "bob@example.com";
const kCarol = "carol@example.com";
const kMaxTimeSpanMS = 42 * k1DayMS;

const kToday = new Date();
kToday.setHours(0, 0, 0, 0);
function daysFromToday(days: number, hours = 0): Date {
  return new Date(kToday.getTime() + days * k1DayMS + hours * k1HourMS);
}

const kBobAppointments = [{
  subject: "Dentist",
  location: "Smile Clinic",
  busyType: "Busy",
  isPrivate: false,
  start: daysFromToday(5, 10),
  end: daysFromToday(5, 11),
}, {
  subject: "Lawyer",
  location: "Downtown",
  busyType: "Busy",
  isPrivate: true,
  start: daysFromToday(2, 14),
  end: daysFromToday(2, 15),
}, {
  // Longer than the longest time span that the server answers, so the client has to ask several times
  subject: "Parental leave",
  location: "",
  busyType: "OOF",
  isPrivate: false,
  start: daysFromToday(20),
  end: daysFromToday(80),
}];

let requests: string[] = [];
let availabilityRequests: { address: string, start: Date, end: Date }[] = [];

function toEWSTime(date: Date): string {
  return date.toISOString().slice(0, 19);
}

/** Exchange prefixes the elements with `m:` and `t:`, but happy-dom's
 * `querySelector()` does not find prefixed elements, unlike Chromium,
 * so these responses use default namespaces. */
function soap(body: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
    <Envelope xmlns="http://schemas.xmlsoap.org/soap/envelope/">
      <Body>${body}</Body>
    </Envelope>`;
}

const kAccessDenied = `
  <GetFolderResponseMessage ResponseClass="Error">
    <MessageText>Access is denied. Check credentials and try again.</MessageText>
    <ResponseCode>ErrorAccessDenied</ResponseCode>
    <DescriptiveLinkKey>0</DescriptiveLinkKey>
  </GetFolderResponseMessage>`;

function freeBusyResponse(address: string, start: Date, end: Date): string {
  availabilityRequests.push({ address, start, end });
  if (end.getTime() - start.getTime() > kMaxTimeSpanMS) {
    return `<FreeBusyResponse><ResponseMessage ResponseClass="Error"><MessageText>Invalid time interval</MessageText><ResponseCode>ErrorInvalidTimeInterval</ResponseCode></ResponseMessage></FreeBusyResponse>`;
  }
  let viewType = address == kBob ? "Detailed" : "FreeBusy";
  let appointments = address == kBob
    ? kBobAppointments.filter(appointment => appointment.start < end && appointment.end > start)
    : [{ subject: "", location: "", busyType: "Busy", isPrivate: false, start: daysFromToday(1, 9), end: daysFromToday(1, 10) }];
  let events = appointments.map(appointment => `
    <CalendarEvent>
      <StartTime>${toEWSTime(appointment.start)}</StartTime>
      <EndTime>${toEWSTime(appointment.end)}</EndTime>
      <BusyType>${appointment.busyType}</BusyType>
      ${viewType == "Detailed" ? `
      <CalendarEventDetails>
        <ID>00000000</ID>
        <Subject>${appointment.subject}</Subject>
        <Location>${appointment.location}</Location>
        <IsMeeting>false</IsMeeting>
        <IsRecurring>false</IsRecurring>
        <IsException>false</IsException>
        <IsReminderSet>false</IsReminderSet>
        <IsPrivate>${appointment.isPrivate}</IsPrivate>
      </CalendarEventDetails>` : ""}
    </CalendarEvent>`).join("");
  return `
    <FreeBusyResponse>
      <ResponseMessage ResponseClass="Success">
        <ResponseCode>NoError</ResponseCode>
      </ResponseMessage>
      <FreeBusyView>
        <FreeBusyViewType xmlns="http://schemas.microsoft.com/exchange/services/2006/types">${viewType}</FreeBusyViewType>
        ${events ? `<CalendarEventArray xmlns="http://schemas.microsoft.com/exchange/services/2006/types">${events}</CalendarEventArray>` : ""}
      </FreeBusyView>
    </FreeBusyResponse>`;
}

/** @param body e.g. `<s:Body><m:GetFolder>…<t:DistinguishedFolderId Id="calendar">…</s:Body>`
 * (happy-dom serializes the request as HTML, so read it as text) */
function serve(body: string): string {
  let operation = body.match(/<s:Body><m:(\w+)>/)[1];
  requests.push(operation);
  switch (operation) {
    case "GetFolder": {
      let count = body.split("<t:DistinguishedFolderId ").length - 1;
      return soap(`
        <GetFolderResponse xmlns="http://schemas.microsoft.com/exchange/services/2006/messages">
          <ResponseMessages>${kAccessDenied.repeat(count)}</ResponseMessages>
        </GetFolderResponse>`);
    }
    case "GetUserAvailabilityRequest": {
      // e.g. `<t:Address>bob@example.com</t:Address>`, `<t:StartTime>2026-11-05T12:47:54.249Z</t:StartTime>`
      let addresses = [...body.matchAll(/<t:Address>([^<]*)<\/t:Address>/g)].map(match => match[1]);
      let start = new Date(body.match(/<t:StartTime>([^<]*)<\/t:StartTime>/)[1]);
      let end = new Date(body.match(/<t:EndTime>([^<]*)<\/t:EndTime>/)[1]);
      return soap(`
        <GetUserAvailabilityResponse xmlns="http://schemas.microsoft.com/exchange/services/2006/messages">
          <FreeBusyResponseArray>${addresses.map(address => freeBusyResponse(address, start, end)).join("")}</FreeBusyResponseArray>
        </GetUserAvailabilityResponse>`);
    }
  }
  throw new Error("Unexpected request " + operation);
}

let account: EWSAccount;

beforeAll(() => {
  let tempDir = mkdtempSync(path.join(tmpdir(), "ews-shared-calendar-limited-test-"));
  appGlobal.remoteApp = {
    getSQLiteDatabase: (filename: string) =>
      new InProcessSQLiteDatabase(path.join(tempDir, filename)),
    getFilesDir: async () => tempDir,
  } as any;
  appGlobal.me = new Person();
  account = new EWSAccount();
  account.name = "Alice";
  account.username = kAlice;
  account.emailAddress = kAlice;
  account.url = "https://exchange.example.com/EWS/Exchange.asmx";
  account.authMethod = AuthMethod.Unknown; // no credentials needed
  globalThis.fetch = (async (url: string, options: any) => {
    let text = serve(options.body);
    return { ok: true, status: 200, text: async () => text };
  }) as any;
});

test("EWS: Sharing: A colleague's calendar with titles and locations can be added", async () => {
  let bob = new PersonUID(kBob, "Bob Builder");
  expect(await account.findSharedFolders(bob, ["msgfolderroot", "inbox", "contacts", "calendar"])).toEqual(["calendar"]);
  expect(await account.findSharedFolders(bob, ["calendar"])).toEqual(["calendar"]);
});

test("EWS: Sharing: A colleague's calendar with only busy times is not offered as a calendar", async () => {
  expect(await account.findSharedFolders(new PersonUID(kCarol, "Carol"), ["calendar"])).toEqual([]);
  expect(await account.findSharedFolders(new PersonUID(kBob, "Bob Builder"), ["contacts"])).toEqual([]);
});

test("EWS: Sharing: Add a colleague's calendar with titles and locations", async () => {
  availabilityRequests = [];
  let calendar = await account.addSharedCalendar(new PersonUID(kBob, "Bob Builder")) as EWSCalendar;

  expect(appGlobal.calendars.contains(calendar)).toBe(true);
  expect(calendar.name).toContain("Bob Builder");
  let events = calendar.events.contents;
  expect(events.map(event => event.title ?? null).sort()).toEqual(["Dentist", "Parental leave", null]);
  let dentist = events.find(event => event.title == "Dentist");
  expect(dentist.location).toBe("Smile Clinic");
  expect(dentist.startTime.getTime()).toBe(kBobAppointments[0].start.getTime());
  expect(dentist.isReadOnly).toBe(true);
  expect(dentist.isEditable).toBe(false);
  await expect(dentist.deleteIt()).rejects.toThrow("Bob Builder");
  expect(() => calendar.newEvent()).toThrow("Bob Builder");

  expect(availabilityRequests.length).toBeGreaterThan(1);
  expect(availabilityRequests.length).toBeLessThan(20);
  for (let request of availabilityRequests) {
    expect(request.address).toBe(kBob);
    expect(request.end.getTime() - request.start.getTime()).toBeLessThanOrEqual(kMaxTimeSpanMS);
  }

  requests = [];
  await calendar.syncOnStartup();
  expect(requests).not.toContain("Subscribe"); // We have no access to the calendar folder
  expect(calendar.events.contents.filter(event => event.title == "Parental leave").length).toBe(1);
});

test("EWS: Shared calendar with only busy times: Not added as calendar", async () => {
  await expect(account.addSharedCalendar(new PersonUID(kCarol, "Carol"))).rejects.toThrow();
  expect(appGlobal.calendars.contents.some(listed => listed.username == kCarol)).toBe(false);
});
