// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { Event } from "../../../../logic/Calendar/Event";
import { getICal } from "../../../../logic/Calendar/ICal/ICalGenerator";
import { convertICalToEvent } from "../../../../logic/Calendar/ICal/ICalToEvent";
import { k1DayMS, k1HourMS } from "../../../../logic/util/date";
import { expect, test } from "vitest";

/** A `TZID` that is not an IANA timezone name: the Windows display name, as Outlook writes it */
const kTZID = "(UTC+01:00) Brussels, Copenhagen, Madrid, Paris";
const kYear = 2026;

/**
 * Times with a `TZID` that only the `VTIMEZONE` defines must be the same
 * as with the real timezone. Takes the `VTIMEZONE` that we write ourselves,
 * which matches what Google Calendar and Outlook write.
 */
const kTimezones = [
  "Europe/Berlin", "Europe/London", "America/New_York", "America/Santiago",
  "Australia/Sydney", "Australia/Lord_Howe", "Pacific/Auckland", "Asia/Kolkata", "America/Phoenix",
];
test.each(kTimezones)("Times in %s are correct all year", async timezone => {
  let vtimezone = (await ourVTimezone(timezone)).replace(`TZID:${timezone}`, `TZID:${kTZID.replace(/,/g, "\\,")}`);
  for (let day = 0; day < 365; day++) {
    let local = new Date(Date.UTC(kYear, 0, 1, 12) + day * k1DayMS);
    expect(parseStartTime(vtimezone, kTZID, local)).toEqual(parseStartTime("", timezone, local));
  }
});

test("Historical rules with UNTIL", () => {
  // The USA changed the dates of the daylight saving time in 2007.
  // Apple Calendar writes the old rules with an end.
  let vtimezone = [
    "BEGIN:VTIMEZONE",
    "TZID:US Eastern",
    "BEGIN:DAYLIGHT",
    "DTSTART:20070311T020000",
    "TZOFFSETFROM:-0500",
    "TZOFFSETTO:-0400",
    "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU",
    "END:DAYLIGHT",
    "BEGIN:STANDARD",
    "DTSTART:20071104T020000",
    "TZOFFSETFROM:-0400",
    "TZOFFSETTO:-0500",
    "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU",
    "END:STANDARD",
    "BEGIN:DAYLIGHT",
    "DTSTART:19870405T020000",
    "TZOFFSETFROM:-0500",
    "TZOFFSETTO:-0400",
    "RRULE:FREQ=YEARLY;UNTIL=20060402T070000Z;BYMONTH=4;BYDAY=1SU",
    "END:DAYLIGHT",
    "BEGIN:STANDARD",
    "DTSTART:19671029T020000",
    "TZOFFSETFROM:-0400",
    "TZOFFSETTO:-0500",
    "RRULE:FREQ=YEARLY;UNTIL=20061029T060000Z;BYMONTH=10;BYDAY=-1SU",
    "END:STANDARD",
    "END:VTIMEZONE",
  ].join("\r\n");
  for (let year of [2005, kYear]) {
    for (let day = 0; day < 365; day++) {
      let local = new Date(Date.UTC(year, 0, 1, 12) + day * k1DayMS);
      expect(parseStartTime(vtimezone, "US Eastern", local)).toEqual(parseStartTime("", "America/New_York", local));
    }
  }
});

test("Rules with BYMONTHDAY", () => {
  // The 2nd Sunday in March and the 1st Sunday in November, as Apple Calendar used to write them
  let vtimezone = [
    "BEGIN:VTIMEZONE",
    "TZID:US Eastern",
    "BEGIN:DAYLIGHT",
    "DTSTART:20070311T020000",
    "TZOFFSETFROM:-0500",
    "TZOFFSETTO:-0400",
    "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=SU;BYMONTHDAY=8,9,10,11,12,13,14",
    "END:DAYLIGHT",
    "BEGIN:STANDARD",
    "DTSTART:20071104T020000",
    "TZOFFSETFROM:-0400",
    "TZOFFSETTO:-0500",
    "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=SU;BYMONTHDAY=1,2,3,4,5,6,7",
    "END:STANDARD",
    "END:VTIMEZONE",
  ].join("\r\n");
  for (let day = 0; day < 365; day++) {
    let local = new Date(Date.UTC(kYear, 0, 1, 12) + day * k1DayMS);
    expect(parseStartTime(vtimezone, "US Eastern", local)).toEqual(parseStartTime("", "America/New_York", local));
  }
});

test("Rules without BYDAY and BYMONTHDAY change on the day of DTSTART", () => {
  let vtimezone = [
    "BEGIN:VTIMEZONE",
    "TZID:Fixed days",
    "BEGIN:DAYLIGHT",
    "DTSTART:19700322T000000",
    "TZOFFSETFROM:+0330",
    "TZOFFSETTO:+0430",
    "RRULE:FREQ=YEARLY;BYMONTH=3",
    "END:DAYLIGHT",
    "BEGIN:STANDARD",
    "DTSTART:19700922T000000",
    "TZOFFSETFROM:+0430",
    "TZOFFSETTO:+0330",
    "RRULE:FREQ=YEARLY;BYMONTH=9",
    "END:STANDARD",
    "END:VTIMEZONE",
  ].join("\r\n");
  for (let [month, day, offsetHours] of [[3, 21, 3.5], [3, 22, 4.5], [9, 21, 4.5], [9, 22, 3.5]]) {
    let local = new Date(Date.UTC(kYear, month - 1, day, 12));
    expect(parseStartTime(vtimezone, "Fixed days", local)).toEqual(new Date(local.getTime() - offsetHours * k1HourMS));
  }
});

test("Changes listed with RDATE", () => {
  let vtimezone = [
    "BEGIN:VTIMEZONE",
    "TZID:Central Europe",
    "BEGIN:STANDARD",
    "DTSTART:20251026T030000",
    "RDATE:20261025T030000",
    "TZOFFSETFROM:+0200",
    "TZOFFSETTO:+0100",
    "END:STANDARD",
    "BEGIN:DAYLIGHT",
    "DTSTART:20260329T020000",
    "RDATE:20270328T020000",
    "TZOFFSETFROM:+0100",
    "TZOFFSETTO:+0200",
    "END:DAYLIGHT",
    "END:VTIMEZONE",
  ].join("\r\n");
  for (let day = 0; day < 540; day++) {
    let local = new Date(Date.UTC(kYear, 0, 1, 12) + day * k1DayMS);
    expect(parseStartTime(vtimezone, "Central Europe", local)).toEqual(parseStartTime("", "Europe/Berlin", local));
  }
});

test("Before the first change, the offset before that change applies", () => {
  let vtimezone = [
    "BEGIN:VTIMEZONE",
    "TZID:Mountain",
    "BEGIN:STANDARD",
    "DTSTART:19700101T000000",
    "TZOFFSETFROM:-0700",
    "TZOFFSETTO:-0700",
    "END:STANDARD",
    "END:VTIMEZONE",
  ].join("\r\n");
  let local = new Date(Date.UTC(1965, 5, 1, 12));
  expect(parseStartTime(vtimezone, "Mountain", local)).toEqual(new Date(local.getTime() + 7 * k1HourMS));
});

test("A part that starts on a date alone", () => {
  // Invalid by RFC 5545 3.6.5, which wants a local time, but seen in real calendars (python-icalendar issue 218)
  let vtimezone = [
    "BEGIN:VTIMEZONE",
    "TZID:UTC+11",
    "BEGIN:STANDARD",
    "DTSTART;VALUE=DATE:20170101",
    "TZOFFSETFROM:+1100",
    "TZOFFSETTO:+1100",
    "END:STANDARD",
    "END:VTIMEZONE",
  ].join("\r\n");
  let local = new Date(Date.UTC(2017, 1, 28, 23));
  expect(parseStartTime(vtimezone, "UTC+11", local)).toEqual(new Date(local.getTime() - 11 * k1HourMS));
});

test("A broken part does not prevent the others", () => {
  let vtimezone = [
    "BEGIN:VTIMEZONE",
    "TZID:Broken",
    "BEGIN:STANDARD",
    "DTSTART:19701025T030000",
    "TZOFFSETFROM:+0200",
    "TZOFFSETTO:+0100",
    "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
    "END:STANDARD",
    "BEGIN:DAYLIGHT",
    "DTSTART:19700329T020000",
    "TZOFFSETFROM:+0100",
    // TZOFFSETTO missing
    "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
    "END:DAYLIGHT",
    "END:VTIMEZONE",
  ].join("\r\n");
  let local = new Date(Date.UTC(kYear, 6, 1, 12));
  expect(parseStartTime(vtimezone, "Broken", local)).toEqual(new Date(local.getTime() - k1HourMS));
});

test("Without a matching VTIMEZONE, there is no start time", () => {
  let local = new Date(Date.UTC(kYear, 6, 1, 12));
  expect(parseStartTime("", kTZID, local)).toBeNull();
});

/** @param local The local time in the UTC fields */
function parseStartTime(vtimezone: string, tzid: string, local: Date): Date | null {
  let iCal = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    ...vtimezone ? [vtimezone] : [],
    "BEGIN:VEVENT",
    "UID:icaltimezone-test@example.com",
    `DTSTART;TZID="${tzid}":${local.toISOString().replace(/-|:|\.\d+Z$/g, "")}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  let event = new Event();
  convertICalToEvent(iCal, event);
  return event.startTime ?? null;
}

async function ourVTimezone(timezone: string): Promise<string> {
  let event = new Event();
  event.calUID = "icaltimezone-test@example.com";
  event.timezone = timezone;
  event.startTime = new Date(Date.UTC(kYear, 5, 15, 12));
  event.endTime = new Date(event.startTime.getTime() + k1HourMS);
  let iCal = await getICal(event);
  let vtimezone = iCal.slice(iCal.indexOf("BEGIN:VTIMEZONE"));
  return vtimezone.slice(0, vtimezone.indexOf("END:VTIMEZONE") + "END:VTIMEZONE".length);
}
