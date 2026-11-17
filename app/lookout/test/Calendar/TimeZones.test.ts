import { TimeZoneChoice, TimeZoneRuler, ZoneClock } from "../../Calendar/TimeZones";
import { HourLabel } from "../../Calendar/DayView/HourLabel";
import { expect, test } from "vitest";

test("Zone clock: wall clock, offset and standard offset of a time zone", () => {
  let newYork = new ZoneClock("America/New_York");
  let summer = new Date(Date.UTC(2026, 6, 1, 12, 0));
  expect(newYork.wallClock(summer)).toEqual({ year: 2026, month: 7, day: 1, hour: 8, minute: 0 });
  expect(newYork.offsetMinutes(summer)).toBe(-240);
  expect(newYork.standardOffsetMinutes(2026)).toBe(-300);
  expect(new ZoneClock("Asia/Kolkata").offsetMinutes(summer)).toBe(330);
  expect(new ZoneClock("Asia/Kolkata").minuteOfDay(summer)).toBe(17 * 60 + 30);
  // Southern hemisphere: daylight saving time in January
  expect(new ZoneClock("Australia/Sydney").standardOffsetMinutes(2026)).toBe(600);
});

test("Hour labels in another time zone: with minutes only where the zone isn't on the full hour", () => {
  let kolkata = new HourLabel("en-US", "Asia/Kolkata");
  let tokyo = new HourLabel("en-US", "Asia/Tokyo");
  let time = new Date(Date.UTC(2026, 9, 16, 11, 0));
  expect(kolkata.labelAt(time)).toBe("4:30 PM");
  expect(tokyo.labelAt(time)).toBe("8 PM");
  expect(new HourLabel("de", "Asia/Kolkata").labelAt(time)).toBe("16:30");
});

test("Second ruler: the hours of the other zone along the local day", () => {
  let day = new Date(2026, 9, 16);
  let ruler = new TimeZoneRuler("Asia/Tokyo", "Tokyo", "en-US");
  let labels = ruler.hourLabels(day);
  expect(labels.length).toBe(24);
  let nine = new Date(2026, 9, 16, 9);
  expect(labels[9]).toBe(new HourLabel("en-US", "Asia/Tokyo").labelAt(nine));
  expect(ruler.isPrimary).toBe(false);
  expect(ruler.shownLabel(nine)).toBe("Tokyo");
  expect(new TimeZoneRuler("Asia/Tokyo", "", "en-US").shownLabel(nine)).toBe("GMT+9");

  let local = new TimeZoneRuler(null, "", "en-US");
  expect(local.isPrimary).toBe(true);
  expect(local.hourLabels(day)[13]).toBe("1 PM");
});

test("Date segments: one per local day for the own zone, at the other zone's midnight for another zone", () => {
  let days = [ new Date(2026, 9, 16), new Date(2026, 9, 17) ];
  let local = new TimeZoneRuler(null, "", "en-US").dateSegments(days);
  expect(local.map(segment => [ segment.startMinute, segment.endMinute ])).toEqual([ [ 0, 1440 ], [ 1440, 2880 ] ]);
  expect(local[1].time).toEqual(days[1]);

  let kolkata = new TimeZoneRuler("Asia/Kolkata", "", "en-US").dateSegments(days);
  // Minutes that Kolkata is ahead of the local time zone
  let ahead = 330 + days[0].getTimezoneOffset();
  let midnight = ((1440 - ahead) % 1440 + 1440) % 1440;
  let starts = kolkata.map(segment => segment.startMinute);
  expect(starts[0]).toBe(0);
  expect(starts).toContain(midnight == 0 ? 1440 : midnight);
  expect(kolkata[kolkata.length - 1].endMinute).toBe(2880);
  for (let segment of kolkata.slice(1)) {
    expect(new ZoneClock("Asia/Kolkata").minuteOfDay(segment.time)).toBe(0);
  }
});

test("Time zone choices: sorted by offset, with the offset in front, and the zones to include", () => {
  let choices = TimeZoneChoice.all("en-US", [ "Europe/Amsterdam" ]);
  expect(choices.length).toBeGreaterThan(100);
  for (let i = 1; i < choices.length; i++) {
    expect(choices[i].standardOffset).toBeGreaterThanOrEqual(choices[i - 1].standardOffset);
  }
  expect(choices.find(choice => choice.zone == "Europe/Amsterdam")).toBeTruthy();
  expect(choices.some(choice => choice.zone.startsWith("Etc/GMT"))).toBe(false);
  expect(choices.find(choice => choice.zone == "Asia/Calcutta").label).toMatch(/^\(UTC\+05:30\) .*Calcutta/);
  expect(choices.find(choice => choice.zone == "America/New_York").label).toBe("(UTC-05:00) Eastern Time (New York)");
  expect(choices.find(choice => choice.zone == "Etc/UTC").label).toBe("(UTC) Coordinated Universal Time");
  expect(TimeZoneChoice.offsetText(-570)).toBe("UTC-09:30");
});
