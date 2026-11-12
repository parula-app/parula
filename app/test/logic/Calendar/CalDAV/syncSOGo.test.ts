// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { CalDAVCalendar } from "../../../../logic/Calendar/CalDAV/CalDAVCalendar";
import { AuthMethod } from "../../../../logic/Abstract/Account";
import { SQLCalendar } from "../../../../logic/Calendar/SQL/SQLCalendar";
import { SQLCalendarStorage } from "../../../../logic/Calendar/SQL/SQLCalendarStorage";
import { InProcessSQLiteDatabase } from "../../util/inProcessSQLite";
import { fetchDAV } from "../../../../../lib/util/fetchDAV";
import { DAVClient } from "tsdav";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, expect, test, vi } from "vitest";

const kServerURL = "https://sogo.example.com/SOGo/dav/";
const kCalendarURL = kServerURL + "fred/Calendar/personal/";

/** As SOGo sends it: The event "Party 🎉", with the emoji as 2 character references,
 * one for each UTF-16 surrogate. */
const kSOGoResponse = `<?xml version="1.0" encoding="utf-8"?>\r
<D:multistatus xmlns:D="DAV:" xmlns:n1="urn:ietf:params:xml:ns:caldav"><D:response><D:href>/SOGo/dav/fred/Calendar/personal/party.ics</D:href><D:propstat><D:prop><D:getetag>&quot;gcs00000001&quot;</D:getetag><n1:calendar-data>BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Inverse inc./SOGo 5.12.1//EN
BEGIN:VEVENT
UID:party
DTSTAMP:20261112T100000Z
DTSTART:20261120T180000Z
DTEND:20261120T230000Z
SUMMARY:Party &#55356;&#57225;
END:VEVENT
END:VCALENDAR
</n1:calendar-data></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response><D:sync-token>1762941600</D:sync-token></D:multistatus>`;

let calendar: CalDAVCalendar;

beforeAll(async () => {
  let tempDir = mkdtempSync(path.join(tmpdir(), "caldav-sogo-test-"));
  appGlobal.remoteApp = {
    getSQLiteDatabase: (filename: string) =>
      new InProcessSQLiteDatabase(path.join(tempDir, filename)),
  } as any;
  vi.stubGlobal("fetch", async () => new Response(kSOGoResponse, {
    status: 207,
    statusText: "Multi-Status",
    headers: { "Content-Type": `text/xml; charset="utf-8"` },
  }));

  calendar = new CalDAVCalendar();
  calendar.name = "SOGo";
  calendar.calendarURL = kCalendarURL;
  calendar.authMethod = AuthMethod.Password;
  calendar.password = "test";
  // `login()` returns early when we already have a client.
  // As created in the backend by `createTSDAVClient()`, and logged in.
  calendar.client = new DAVClient({
    serverUrl: kServerURL,
    authMethod: "Basic",
    credentials: { username: "fred", password: "test" },
    defaultAccountType: "caldav",
    fetch: fetchDAV,
  });
  calendar.client.account = { accountType: "caldav", serverUrl: kServerURL, rootUrl: kServerURL, homeUrl: kServerURL + "fred/Calendar/" };
  calendar.storage = new SQLCalendarStorage();
  await SQLCalendar.save(calendar);
  appGlobal.calendars.add(calendar);
});

test("Sync a SOGo calendar with an emoji in an event", async () => {
  await calendar.listEvents();
  expect(calendar.events.contents.map(event => event.title)).toContain("Party 🎉");
});
