import { expect, test } from 'vitest';
import { Frequency, Weekday, RecurrenceInit, RecurrenceRule } from '../../../logic/Calendar/RecurrenceRule';

/** All times below, so that the expected RRULEs don't depend on the machine's zone. */
const kTimezone = "UTC";

function check(calString: string, data: Partial<RecurrenceInit>, expected: [number, number, number][]) {
  data.masterDuration = 36e5;
  data.timezone = kTimezone;
  let rule = new RecurrenceRule(data as RecurrenceInit);
  if (calString) {
    expect(rule.getCalString()).toEqual(calString);
    let ruleFromString = RecurrenceRule.fromCalString(36e5, kTimezone, data.seriesStartTime as Date, calString);
    expect(rule).toEqual(ruleFromString);
  }
  let expectedDates = expected.map(args => new Date(Date.UTC(...args)));
  expect(rule.getOccurrenceBefore(expectedDates[1])).toEqual(expectedDates[0]);
  expect(rule.getOccurrenceByIndex(1)).toEqual(expectedDates[1]);
  expect(rule.getOccurrenceAfter(expectedDates[1])).toEqual(expectedDates[2]);
  expect(rule.getOccurrencesByDate(new Date(Date.UTC(2010, 10, 10)))).toEqual(expectedDates);
}

test("Daily with interval and end date", () => {
  check("RRULE:FREQ=DAILY;UNTIL=20000105T000000Z;INTERVAL=2", {
    seriesStartTime: new Date(Date.UTC(2000, 0, 1)),
    seriesEndTime: new Date(Date.UTC(2000, 0, 5)),
    frequency: Frequency.Daily,
    interval: 2,
  }, [[2000, 0, 1], [2000, 0, 3], [2000, 0, 5]]);
});

test("Daily with interval and count", () => {
  check("RRULE:FREQ=DAILY;COUNT=3;INTERVAL=2", {
    seriesStartTime: new Date(Date.UTC(2000, 0, 1)),
    count: 3,
    frequency: Frequency.Daily,
    interval: 2,
  }, [[2000, 0, 1], [2000, 0, 3], [2000, 0, 5]]);
});

test("Daily with days and end date", () => {
  check("RRULE:FREQ=DAILY;UNTIL=20000105T000000Z;BYDAY=SA,MO,WE", {
    seriesStartTime: new Date(Date.UTC(2000, 0, 1)),
    seriesEndTime: new Date(Date.UTC(2000, 0, 5)),
    frequency: Frequency.Daily,
    weekdays: [Weekday.Saturday, Weekday.Monday, Weekday.Wednesday],
  }, [[2000, 0, 1], [2000, 0, 3], [2000, 0, 5]]);
});

test("Daily with days and count", () => {
  check("RRULE:FREQ=DAILY;COUNT=3;BYDAY=SA,SU", {
    seriesStartTime: new Date(Date.UTC(2000, 0, 1)),
    count: 3,
    frequency: Frequency.Daily,
    weekdays: [Weekday.Saturday, Weekday.Sunday],
  }, [[2000, 0, 1], [2000, 0, 2], [2000, 0, 8]]);
});

test("Weekly with interval and end date", () => {
  check("RRULE:FREQ=WEEKLY;UNTIL=20000131T000000Z;INTERVAL=2", {
    seriesStartTime: new Date(Date.UTC(2000, 0, 1)),
    seriesEndTime: new Date(Date.UTC(2000, 0, 31)),
    frequency: Frequency.Weekly,
    interval: 2,
  }, [[2000, 0, 1], [2000, 0, 15], [2000, 0, 29]]);
});

test("Weekly with interval and count", () => {
  check("RRULE:FREQ=WEEKLY;COUNT=3;INTERVAL=2", {
    seriesStartTime: new Date(Date.UTC(2000, 0, 1)),
    count: 3,
    frequency: Frequency.Weekly,
    interval: 2,
  }, [[2000, 0, 1], [2000, 0, 15], [2000, 0, 29]]);
});

test("Weekly with days and end date", () => {
  check("RRULE:FREQ=WEEKLY;UNTIL=20000131T000000Z;INTERVAL=3;BYDAY=SA,SU", {
    seriesStartTime: new Date(Date.UTC(2000, 0, 1)),
    seriesEndTime: new Date(Date.UTC(2000, 0, 31)),
    frequency: Frequency.Weekly,
    interval: 3,
    weekdays: [Weekday.Saturday, Weekday.Sunday],
  }, [[2000, 0, 1], [2000, 0, 2], [2000, 0, 22], [2000, 0, 23]]);
});

test("Weekly with days and count", () => {
  check("RRULE:FREQ=WEEKLY;COUNT=3;INTERVAL=3;BYDAY=SA,SU", {
    seriesStartTime: new Date(Date.UTC(2000, 0, 1)),
    count: 3,
    frequency: Frequency.Weekly,
    interval: 3,
    weekdays: [Weekday.Saturday, Weekday.Sunday],
  }, [[2000, 0, 1], [2000, 0, 2], [2000, 0, 22]]);
});

test("Monthly with date and end date", () => {
  check("RRULE:FREQ=MONTHLY;UNTIL=20001230T000000Z;INTERVAL=3", {
    seriesStartTime: new Date(Date.UTC(2000, 0, 31)),
    seriesEndTime: new Date(Date.UTC(2000, 11, 30)),
    frequency: Frequency.Monthly,
    interval: 3,
  }, [[2000, 0, 31], [2000, 3, 30], [2000, 6, 31], [2000, 9, 31]]);
});

test("Monthly with date and count", () => {
  check("RRULE:FREQ=MONTHLY;COUNT=3;INTERVAL=3", {
    seriesStartTime: new Date(Date.UTC(2000, 0, 31)),
    count: 3,
    frequency: Frequency.Monthly,
    interval: 3,
  }, [[2000, 0, 31], [2000, 3, 30], [2000, 6, 31]]);
});

test("Monthly with day of week of month and end date", () => {
  check("RRULE:FREQ=MONTHLY;UNTIL=20001201T000000Z;INTERVAL=3;BYDAY=2SU", {
    seriesStartTime: new Date(Date.UTC(2000, 0, 9)),
    seriesEndTime: new Date(Date.UTC(2000, 11, 1)),
    frequency: Frequency.Monthly,
    interval: 3,
    weekdays: [Weekday.Sunday],
    week: 2,
  }, [[2000, 0, 9], [2000, 3, 9], [2000, 6, 9], [2000, 9, 8]]);
});

test("Monthly with day of week of month and count", () => {
  check("RRULE:FREQ=MONTHLY;COUNT=3;INTERVAL=3;BYDAY=2SU", {
    seriesStartTime: new Date(Date.UTC(2000, 0, 9)),
    count: 3,
    frequency: Frequency.Monthly,
    interval: 3,
    weekdays: [Weekday.Sunday],
    week: 2,
  }, [[2000, 0, 9], [2000, 3, 9], [2000, 6, 9]]);
});

test("Monthly with day of last week of month and end date", () => {
  check("RRULE:FREQ=MONTHLY;UNTIL=20001201T000000Z;INTERVAL=3;BYDAY=-1SU", {
    seriesStartTime: new Date(Date.UTC(2000, 0, 30)),
    seriesEndTime: new Date(Date.UTC(2000, 11, 1)),
    frequency: Frequency.Monthly,
    interval: 3,
    weekdays: [Weekday.Sunday],
    week: 5,
  }, [[2000, 0, 30], [2000, 3, 30], [2000, 6, 30], [2000, 9, 29]]);
});

test("Monthly with day of last week of month and count", () => {
  check("RRULE:FREQ=MONTHLY;COUNT=3;INTERVAL=3;BYDAY=-1SU", {
    seriesStartTime: new Date(Date.UTC(2000, 0, 30)),
    count: 3,
    frequency: Frequency.Monthly,
    interval: 3,
    weekdays: [Weekday.Sunday],
    week: 5,
  }, [[2000, 0, 30], [2000, 3, 30], [2000, 6, 30]]);
});

test("Yearly with date and end date", () => {
  check("RRULE:FREQ=YEARLY;UNTIL=20021201T000000Z", {
    seriesStartTime: new Date(Date.UTC(2000, 1, 29)),
    seriesEndTime: new Date(Date.UTC(2002, 11, 1)),
    frequency: Frequency.Yearly,
  }, [[2000, 1, 29], [2001, 1, 28], [2002, 1, 28]]);
});

test("Yearly with date and count", () => {
  check("RRULE:FREQ=YEARLY;COUNT=3", {
    seriesStartTime: new Date(Date.UTC(2000, 1, 29)),
    count: 3,
    frequency: Frequency.Yearly,
  }, [[2000, 1, 29], [2001, 1, 28], [2002, 1, 28]]);
});

test("Yearly with day of week of month and end date", () => {
  check("RRULE:FREQ=YEARLY;UNTIL=20021201T000000Z;BYDAY=2SU", {
    seriesStartTime: new Date(Date.UTC(2000, 0, 9)),
    seriesEndTime: new Date(Date.UTC(2002, 11, 1)),
    frequency: Frequency.Yearly,
    weekdays: [Weekday.Sunday],
    week: 2,
  }, [[2000, 0, 9], [2001, 0, 14], [2002, 0, 13]]);
});

test("Yearly with day of week of month and count", () => {
  check("RRULE:FREQ=YEARLY;COUNT=3;BYDAY=2SU", {
    seriesStartTime: new Date(Date.UTC(2000, 0, 9)),
    count: 3,
    frequency: Frequency.Yearly,
    weekdays: [Weekday.Sunday],
    week: 2,
  }, [[2000, 0, 9], [2001, 0, 14], [2002, 0, 13]]);
});

test("Yearly with day of last week of month and end date", () => {
  check("RRULE:FREQ=YEARLY;UNTIL=20021201T000000Z;BYDAY=-1SU", {
    seriesStartTime: new Date(Date.UTC(2000, 0, 30)),
    seriesEndTime: new Date(Date.UTC(2002, 11, 1)),
    frequency: Frequency.Yearly,
    weekdays: [Weekday.Sunday],
    week: 5,
  }, [[2000, 0, 30], [2001, 0, 28], [2002, 0, 27]]);
});

test("Yearly with day of last week of month and count", () => {
  check("RRULE:FREQ=YEARLY;COUNT=3;BYDAY=-1SU", {
    seriesStartTime: new Date(Date.UTC(2000, 0, 30)),
    count: 3,
    frequency: Frequency.Yearly,
    weekdays: [Weekday.Sunday],
    week: 5,
  }, [[2000, 0, 30], [2001, 0, 28], [2002, 0, 27]]);
});

/** Every Monday at 9:00, starting 3 January 2000, with the given end */
function mondays(end: Partial<RecurrenceInit> = {}): RecurrenceRule {
  return new RecurrenceRule({
    masterDuration: 36e5,
    timezone: kTimezone,
    seriesStartTime: new Date(Date.UTC(2000, 0, 3, 9)),
    frequency: Frequency.Weekly,
    weekdays: [Weekday.Monday],
    ...end,
  });
}

// A new series end must reach the attendees, so `matches()` (used by `Event.hasChanged()`)
// sees it. But the occurrences stay at the same times, so the exceptions are still valid,
// and `timesMatch()` (used to ask "Save changes?" and to remove all exceptions) ignores it.
test("A changed series end is a change, but not of the occurrence times", () => {
  let endless = mondays();
  let fiveTimes = mondays({ count: 5 });
  let sixTimes = mondays({ count: 6 });
  let untilFebruary = mondays({ seriesEndTime: new Date(Date.UTC(2000, 1, 1)) });
  let untilMarch = mondays({ seriesEndTime: new Date(Date.UTC(2000, 2, 1)) });
  let changes: [RecurrenceRule, RecurrenceRule][] = [
    [endless, fiveTimes],
    [fiveTimes, endless],
    [fiveTimes, sixTimes],
    [endless, untilFebruary],
    [untilFebruary, endless],
    [untilFebruary, untilMarch],
    [fiveTimes, untilFebruary],
    [untilFebruary, fiveTimes],
  ];
  for (let [before, after] of changes) {
    expect(after.matches(before)).toBe(false);
    expect(after.timesMatch(before)).toBe(true);
  }
});

test("The same series end is no change", () => {
  expect(mondays().matches(mondays())).toBe(true);
  expect(mondays({ count: 5 }).matches(mondays({ count: 5 }))).toBe(true);
  expect(mondays({ seriesEndTime: new Date(Date.UTC(2000, 1, 1)) })
    .matches(mondays({ seriesEndTime: new Date(Date.UTC(2000, 1, 1)) }))).toBe(true);
  // `Event.newRecurrenceRule()` passes on a missing end as `null` and `Infinity`
  expect(mondays({ seriesEndTime: null, count: Infinity }).matches(mondays())).toBe(true);
  expect(mondays({ seriesEndTime: undefined }).matches(mondays())).toBe(true);
});
