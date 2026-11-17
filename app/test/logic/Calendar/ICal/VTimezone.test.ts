// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { Event } from "../../../../logic/Calendar/Event";
import { getICal } from "../../../../logic/Calendar/ICal/ICalGenerator";
import { k1HourMS, k1MinuteMS } from "../../../../logic/util/date";
import { expect, test } from "vitest";

/** The `VTIMEZONE`s that Google Calendar and Outlook write for these timezones */
const kExpected: Record<string, string[]> = {
  "Europe/Berlin": [
    "BEGIN:VTIMEZONE",
    "TZID:Europe/Berlin",
    "BEGIN:STANDARD",
    "DTSTART:19701025T030000",
    "TZOFFSETFROM:+0200",
    "TZOFFSETTO:+0100",
    "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
    "END:STANDARD",
    "BEGIN:DAYLIGHT",
    "DTSTART:19700329T020000",
    "TZOFFSETFROM:+0100",
    "TZOFFSETTO:+0200",
    "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
    "END:DAYLIGHT",
    "END:VTIMEZONE",
  ],
  "America/New_York": [
    "BEGIN:VTIMEZONE",
    "TZID:America/New_York",
    "BEGIN:STANDARD",
    "DTSTART:19701101T020000",
    "TZOFFSETFROM:-0400",
    "TZOFFSETTO:-0500",
    "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU",
    "END:STANDARD",
    "BEGIN:DAYLIGHT",
    "DTSTART:19700308T020000",
    "TZOFFSETFROM:-0500",
    "TZOFFSETTO:-0400",
    "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU",
    "END:DAYLIGHT",
    "END:VTIMEZONE",
  ],
  // Summer time during our winter
  "Australia/Sydney": [
    "BEGIN:VTIMEZONE",
    "TZID:Australia/Sydney",
    "BEGIN:STANDARD",
    "DTSTART:19700405T030000",
    "TZOFFSETFROM:+1100",
    "TZOFFSETTO:+1000",
    "RRULE:FREQ=YEARLY;BYMONTH=4;BYDAY=1SU",
    "END:STANDARD",
    "BEGIN:DAYLIGHT",
    "DTSTART:19701004T020000",
    "TZOFFSETFROM:+1000",
    "TZOFFSETTO:+1100",
    "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=1SU",
    "END:DAYLIGHT",
    "END:VTIMEZONE",
  ],
  // No daylight saving time, and a half hour offset
  "Asia/Kolkata": [
    "BEGIN:VTIMEZONE",
    "TZID:Asia/Kolkata",
    "BEGIN:STANDARD",
    "DTSTART:19700101T000000",
    "TZOFFSETFROM:+0530",
    "TZOFFSETTO:+0530",
    "END:STANDARD",
    "END:VTIMEZONE",
  ],
};

test.each(Object.keys(kExpected))("VTIMEZONE for %s", async timezone => {
  let iCal = await getICal(eventIn(timezone));
  expect(iCal).toContain(kExpected[timezone].join("\r\n"));
});

test("Uses the rules of the year of the event", async () => {
  // The USA changed the dates of the daylight saving time in 2007
  let iCal = await getICal(eventIn("America/New_York", new Date(Date.UTC(2005, 5, 15, 12))));
  expect(iCal).toContain("RRULE:FREQ=YEARLY;BYMONTH=4;BYDAY=1SU");
  expect(iCal).toContain("RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU");
});

test("VTIMEZONE comes before the event that uses it", async () => {
  let iCal = await getICal(eventIn("Europe/Berlin"));
  expect(iCal.indexOf("BEGIN:VTIMEZONE")).toBeLessThan(iCal.indexOf("BEGIN:VEVENT"));
  expect(iCal).toContain("DTSTART;VALUE=DATE-TIME;TZID=Europe/Berlin:");
});

test("No VTIMEZONE where we write no TZID", async () => {
  let utc = eventIn("UTC");
  expect(await getICal(utc)).not.toContain("VTIMEZONE");

  let allDay = eventIn("Europe/Berlin");
  allDay.allDay = true;
  expect(await getICal(allDay)).not.toContain("VTIMEZONE");
});

test("Each timezone only once, despite exceptions", async () => {
  let event = eventIn("Europe/Berlin");
  let exception = eventIn("Europe/Berlin");
  exception.recurrenceStartTime = event.startTime;
  event.exceptions.add(exception);
  let iCal = await getICal(event);
  expect(iCal.match(/BEGIN:VTIMEZONE/g)).toHaveLength(1);
  expect(iCal.match(/BEGIN:VEVENT/g)).toHaveLength(2);
});

/**
 * Reading the times back out of our `VTIMEZONE`, the way that Outlook does,
 * must give the same times as the real timezone, all year long.
 */
const kTimezones = [
  "Europe/Berlin", "Europe/London", "Europe/Lisbon", "Europe/Athens",
  "America/New_York", "America/Chicago", "America/Los_Angeles", "America/Santiago",
  "Australia/Sydney", "Australia/Lord_Howe", "Pacific/Auckland", "Asia/Jerusalem",
  "Asia/Kolkata", "Asia/Tokyo", "America/Phoenix",
];
const kYear = 2026;
test.each(kTimezones)("Times in %s are correct all year", async timezone => {
  let iCal = await getICal(eventIn(timezone, new Date(Date.UTC(kYear, 5, 15, 12))));
  let observances = parseVTimezone(iCal, timezone);
  for (let day = 1; day <= 365; day++) {
    let time = new Date(Date.UTC(kYear, 0, day, 12));
    expect(`${time.toISOString()} ${offsetFromObservances(observances, time)}`)
      .toBe(`${time.toISOString()} ${utcOffset(time, timezone)}`);
  }
});

function eventIn(timezone: string, startTime = new Date(Date.UTC(kYear, 5, 15, 12))): Event {
  let event = new Event();
  event.calUID = "b0d1c2e3-0000-0000-0000-000000000001";
  event.title = "Test event";
  event.timezone = timezone;
  event.startTime = startTime;
  event.endTime = new Date(startTime.getTime() + k1HourMS);
  return event;
}

interface Observance {
  /** Local time when the change happens, e.g. "19700329T020000" */
  start: string;
  /** In minutes */
  offsetFrom: number;
  offsetTo: number;
  /** e.g. "FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU" */
  recurrenceRule: string | null;
}

/** Reads back the `STANDARD` and `DAYLIGHT` parts of the `VTIMEZONE` for `timezone` */
function parseVTimezone(iCal: string, timezone: string): Observance[] {
  let component = iCal.slice(iCal.indexOf(`TZID:${timezone}\r\n`));
  component = component.slice(0, component.indexOf("END:VTIMEZONE"));
  let observances: Observance[] = [];
  let current: Observance | null = null;
  for (let line of component.split("\r\n")) {
    if (line == "BEGIN:STANDARD" || line == "BEGIN:DAYLIGHT") {
      current = { start: null, offsetFrom: null, offsetTo: null, recurrenceRule: null };
      observances.push(current);
    } else if (!current) {
      continue;
    } else if (line.startsWith("DTSTART:")) {
      current.start = line.slice("DTSTART:".length);
    } else if (line.startsWith("TZOFFSETFROM:")) {
      current.offsetFrom = parseOffset(line.slice("TZOFFSETFROM:".length));
    } else if (line.startsWith("TZOFFSETTO:")) {
      current.offsetTo = parseOffset(line.slice("TZOFFSETTO:".length));
    } else if (line.startsWith("RRULE:")) {
      current.recurrenceRule = line.slice("RRULE:".length);
    }
  }
  expect(observances.length).toBeGreaterThan(0);
  return observances;
}

/** @param offset e.g. "+0530" @returns minutes */
function parseOffset(offset: string): number {
  expect(offset).toMatch(/^[+-]\d{4}$/);
  return (offset.startsWith("-") ? -1 : 1) *
    (parseInt(offset.slice(1, 3)) * 60 + parseInt(offset.slice(3, 5)));
}

/** The UTC offset at `time`, according to the observances, in minutes.
 * Uses the change that happened last before `time`, like Outlook does. */
function offsetFromObservances(observances: Observance[], time: Date): number {
  if (!observances[0].recurrenceRule) {
    return observances[0].offsetTo;
  }
  let last = null;
  for (let year of [time.getUTCFullYear() - 1, time.getUTCFullYear()]) {
    for (let observance of observances) {
      let change = changeTime(observance, year);
      if (change <= time.getTime() && (!last || change > last.change)) {
        last = { change, offset: observance.offsetTo };
      }
    }
  }
  return last.offset;
}

/** When the change of `observance` happens in `year`, in UTC */
function changeTime(observance: Observance, year: number): number {
  let [, month, nth, weekday] = /BYMONTH=(\d+);BYDAY=(-?\d+)(\w\w)/.exec(observance.recurrenceRule);
  let day = dayOfNthWeekday(year, parseInt(month), parseInt(nth), kWeekdays.indexOf(weekday));
  let local = Date.UTC(year, parseInt(month) - 1, day,
    parseInt(observance.start.slice(9, 11)),
    parseInt(observance.start.slice(11, 13)),
    parseInt(observance.start.slice(13, 15)));
  return local - observance.offsetFrom * k1MinuteMS;
}

const kWeekdays = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

/** The day of the month of e.g. the 2nd Sunday, by counting all Sundays
 * @param month 1 = January
 * @param nth -1 = the last one */
function dayOfNthWeekday(year: number, month: number, nth: number, weekday: number): number {
  let days: number[] = [];
  for (let day = 1; day <= 31; day++) {
    let date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCMonth() == month - 1 && date.getUTCDay() == weekday) {
      days.push(day);
    }
  }
  return nth > 0 ? days[nth - 1] : days.at(nth);
}

/** How many minutes the local time in `timezone` is ahead of UTC, at `time`,
 * from the timezone database, as the yardstick for our own calculation */
function utcOffset(time: Date, timezone: string): number {
  let offset = new Intl.DateTimeFormat("en-US", { timeZone: timezone, timeZoneName: "longOffset" })
    .format(time).replace(/.*GMT/, "");
  if (!offset) { // "GMT" alone, for UTC
    return 0;
  }
  return (offset.startsWith("-") ? -1 : 1) *
    (parseInt(offset.slice(1, 3)) * 60 + parseInt(offset.slice(4, 6)));
}
