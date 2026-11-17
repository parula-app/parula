// @vitest-environment happy-dom
import "../../../../logic/app"; // first, to resolve the import cycle around Abstract/Account.ts
import { Calendar } from "../../../../logic/Calendar/Calendar";
import { Event, RecurrenceCase } from "../../../../logic/Calendar/Event";
import { Frequency, RecurrenceRule } from "../../../../logic/Calendar/RecurrenceRule";
import { DummyCalendarStorage } from "../../../../logic/Calendar/SQL/DummyCalendarStorage";
import { RecurrencePattern } from "../../../Calendar/EditEvent/RecurrencePattern";
import { expect, test } from "vitest";

function newEvent(start = new Date(2026, 9, 15, 10, 0)): Event {
  let calendar = new Calendar();
  calendar.storage = new DummyCalendarStorage();
  let event = calendar.newEvent();
  event.title = "Planning";
  event.startTime = start;
  event.endTime = new Date(start.getTime() + 30 * 60000);
  event.startEditing();
  return event;
}

test("Defaults for an event without recurrence: weekly on its weekday, no end", () => {
  let event = newEvent(); // Thursday
  let pattern = RecurrencePattern.fromEvent(event);
  expect(pattern.frequency).toBe(Frequency.Weekly);
  expect(pattern.interval).toBe(1);
  expect(pattern.weekdays).toEqual([4]);
  expect(pattern.end).toBe("none");
});

test("Weekly pattern applied to the event, always including the start weekday", () => {
  let event = newEvent();
  let pattern = RecurrencePattern.fromEvent(event);
  pattern.weekdays = [1];
  pattern.interval = 2;
  pattern.applyTo(event);
  expect(event.recurrenceCase).toBe(RecurrenceCase.Master);
  expect(event.recurrenceRule.frequency).toBe(Frequency.Weekly);
  expect(event.recurrenceRule.interval).toBe(2);
  expect(event.recurrenceRule.weekdays.sort()).toEqual([1, 4]);
});

test("Every weekday is a weekly rule from Monday to Friday", () => {
  let event = newEvent();
  let pattern = RecurrencePattern.fromEvent(event);
  pattern.frequency = Frequency.Daily;
  pattern.dailyMode = "weekdays";
  pattern.applyTo(event);
  expect(event.recurrenceRule.frequency).toBe(Frequency.Weekly);
  expect(event.recurrenceRule.weekdays.sort()).toEqual([1, 2, 3, 4, 5]);
});

test("Every weekday is not possible when the series starts on a weekend", () => {
  let saturday = new Date(2026, 9, 17, 10, 0);
  expect(RecurrencePattern.canRepeatOnWeekdays(saturday)).toBe(false);
  let event = newEvent(saturday);
  let pattern = RecurrencePattern.fromEvent(event);
  pattern.frequency = Frequency.Daily;
  pattern.dailyMode = "weekdays";
  pattern.interval = 3;
  pattern.applyTo(event);
  expect(event.recurrenceRule.frequency).toBe(Frequency.Daily);
  expect(event.recurrenceRule.interval).toBe(3);
});

test("Monthly: on the third Thursday, or on the last Thursday", () => {
  let thirdThursday = new Date(2026, 9, 15, 10, 0);
  expect(RecurrencePattern.weekOfMonth(thirdThursday)).toBe(3);
  expect(RecurrencePattern.isInLastWeek(thirdThursday)).toBe(false);
  let lastThursday = new Date(2026, 9, 29, 10, 0);
  expect(RecurrencePattern.weekOfMonth(lastThursday)).toBe(5);
  expect(RecurrencePattern.isInLastWeek(lastThursday)).toBe(true);
  let fourthAndLast = new Date(2026, 9, 22, 10, 0);
  expect(RecurrencePattern.weekOfMonth(fourthAndLast)).toBe(4);
  expect(RecurrencePattern.isInLastWeek(fourthAndLast)).toBe(false);
  let fourthAndLastInNovember = new Date(2026, 10, 26, 10, 0);
  expect(RecurrencePattern.weekOfMonth(fourthAndLastInNovember)).toBe(4);
  expect(RecurrencePattern.isInLastWeek(fourthAndLastInNovember)).toBe(true);

  let event = newEvent(thirdThursday);
  let pattern = RecurrencePattern.fromEvent(event);
  pattern.frequency = Frequency.Monthly;
  pattern.monthlyMode = "weekday";
  pattern.applyTo(event);
  expect(event.recurrenceRule.week).toBe(3);
  expect(event.recurrenceRule.weekdays).toEqual([4]);
  let next = event.recurrenceRule.getOccurrenceByIndex(1);
  expect(next).toEqual(new Date(2026, 10, 19, 10, 0)); // third Thursday in November

  let lastEvent = newEvent(fourthAndLastInNovember);
  pattern = RecurrencePattern.fromEvent(lastEvent);
  pattern.frequency = Frequency.Monthly;
  pattern.monthlyMode = "last-weekday";
  pattern.applyTo(lastEvent);
  expect(lastEvent.recurrenceRule.week).toBe(5);
  expect(lastEvent.recurrenceRule.getOccurrenceByIndex(1)).toEqual(new Date(2026, 11, 31, 10, 0));
});

test("Monthly on the day of the month", () => {
  let event = newEvent();
  let pattern = RecurrencePattern.fromEvent(event);
  pattern.frequency = Frequency.Monthly;
  pattern.monthlyMode = "day";
  pattern.applyTo(event);
  expect(event.recurrenceRule.week).toBe(0);
  expect(event.recurrenceRule.getOccurrenceByIndex(1)).toEqual(new Date(2026, 10, 15, 10, 0));
});

test("Reads the existing rule, including the end", async () => {
  let event = newEvent();
  event.newRecurrenceRule(Frequency.Monthly, 2, 3);
  await event.setRecurrenceCount(5);
  let pattern = RecurrencePattern.fromEvent(event);
  expect(pattern.frequency).toBe(Frequency.Monthly);
  expect(pattern.interval).toBe(2);
  expect(pattern.monthlyMode).toBe("weekday");
  expect(pattern.end).toBe("count");
  expect(pattern.count).toBe(5);

  await event.setRecurrenceEndTime(new Date(2027, 2, 1, 23, 59, 59));
  pattern = RecurrencePattern.fromEvent(event);
  expect(pattern.end).toBe("date");
  expect(pattern.endDate).toEqual(new Date(2027, 2, 1, 23, 59, 59));
});

test("End after N occurrences", async () => {
  let event = newEvent();
  let pattern = RecurrencePattern.fromEvent(event);
  pattern.applyTo(event);
  pattern.end = "count";
  pattern.count = 4;
  expect(pattern.endDiffersFrom(event.recurrenceRule)).toBe(true);
  await pattern.applyEndTo(event);
  expect(event.recurrenceRule.count).toBe(4);
  expect(event.recurrenceRule.getOccurrenceByIndex(3)).toEqual(new Date(2026, 10, 5, 10, 0));
  expect(event.recurrenceRule.getOccurrenceByIndex(4)).toBeUndefined();
  expect(pattern.endDiffersFrom(event.recurrenceRule)).toBe(false);
});

test("End after N occurrences, when the first occurrences are skipped", async () => {
  let event = newEvent();
  let pattern = RecurrencePattern.fromEvent(event);
  pattern.applyTo(event);
  pattern.end = "count";
  pattern.count = 10;
  await pattern.applyEndTo(event, 3);
  expect(event.recurrenceRule.count).toBe(7);
});

test("End by a date includes the whole day", async () => {
  let event = newEvent();
  let pattern = RecurrencePattern.fromEvent(event);
  pattern.applyTo(event);
  pattern.end = "date";
  pattern.endDate = new Date(2026, 10, 5);
  await pattern.applyEndTo(event);
  expect(event.recurrenceRule.seriesEndTime).toEqual(new Date(2026, 10, 5, 23, 59, 59));
  expect(event.recurrenceRule.getOccurrencesByDate(new Date(2027, 0, 1)).at(-1)).toEqual(new Date(2026, 10, 5, 10, 0));
  expect(pattern.endDiffersFrom(event.recurrenceRule)).toBe(false);
});

test("No end date removes the end", async () => {
  let event = newEvent();
  let pattern = RecurrencePattern.fromEvent(event);
  pattern.applyTo(event);
  await event.setRecurrenceCount(3);
  pattern = RecurrencePattern.fromEvent(event);
  pattern.end = "none";
  expect(pattern.endDiffersFrom(event.recurrenceRule)).toBe(true);
  await pattern.applyEndTo(event);
  expect(event.recurrenceRule.count).toBe(Infinity);
  expect(event.recurrenceRule.seriesEndTime).toBe(null);
  expect(event.recurrenceRule.getOccurrenceByIndex(100)).toBeDefined();
});

test("Changing the pattern keeps the end", async () => {
  let event = newEvent();
  let pattern = RecurrencePattern.fromEvent(event);
  pattern.applyTo(event);
  await event.setRecurrenceCount(3);
  pattern = RecurrencePattern.fromEvent(event);
  pattern.frequency = Frequency.Daily;
  pattern.applyTo(event);
  expect(event.recurrenceRule.frequency).toBe(Frequency.Daily);
  expect(event.recurrenceRule.count).toBe(3);
});

test("Remove the recurrence", () => {
  let event = newEvent();
  RecurrencePattern.fromEvent(event).applyTo(event);
  RecurrencePattern.removeFrom(event);
  expect(event.recurrenceRule).toBe(null);
  expect(event.recurrenceCase).toBe(RecurrenceCase.Normal);
});

test("An occurrence changes the recurrence of its series, which keeps its start", () => {
  let event = newEvent();
  RecurrencePattern.fromEvent(event).applyTo(event);
  event.calendar.events.add(event);
  let occurrence = event.instances.get(2);
  expect(occurrence.parentEvent).toBe(event);
  let pattern = RecurrencePattern.fromEvent(occurrence);
  expect(pattern.frequency).toBe(Frequency.Weekly);
  pattern.frequency = Frequency.Daily;
  pattern.applyTo(occurrence);
  expect(event.recurrenceRule.frequency).toBe(Frequency.Daily);
  expect(event.startTime).toEqual(new Date(2026, 9, 15, 10, 0));
  expect(event.hasChanged()).toBe(true);
});

test("A weekly rule without weekdays, opened from an exception on another day, is on the weekday of the series", async () => {
  let event = newEvent(); // Thursday
  event.recurrenceRule = RecurrenceRule.fromCalString(event.duration, event.timezone, event.startTime, "RRULE:FREQ=WEEKLY");
  expect(event.recurrenceRule.weekdays).toBe(null);
  event.calendar.events.add(event);
  await event.save();
  let exception = event.instances.get(1);
  exception.startEditing();
  exception.startTime = new Date(2026, 9, 23, 10, 0);
  exception.endTime = new Date(2026, 9, 23, 10, 30);
  await exception.save();
  let pattern = RecurrencePattern.fromEvent(exception);
  expect(pattern.weekdays).toEqual([4]);
});

test("The same rule, also with another end, but not with other weekdays or interval", () => {
  let pattern = RecurrencePattern.fromEvent(newEvent());
  let changed = pattern.clone();
  changed.end = "count";
  changed.count = 5;
  expect(changed.hasSameRuleAs(pattern)).toBe(true);
  changed.weekdays = [4, 1];
  expect(changed.hasSameRuleAs(pattern)).toBe(false);
  changed = pattern.clone();
  changed.interval = 2;
  expect(changed.hasSameRuleAs(pattern)).toBe(false);
});

test("Summary", async () => {
  let event = newEvent();
  let pattern = RecurrencePattern.fromEvent(event);
  pattern.applyTo(event);
  expect(pattern.summary(event)).toMatch(/^Every week, on Thursday, effective 10\/15\/2026, from 10:00 AM to 10:30 AM$/);
  pattern.end = "date";
  pattern.endDate = new Date(2026, 11, 17);
  expect(pattern.summary(event)).toContain("effective 10/15/2026 until 12/17/2026");
  pattern.end = "count";
  pattern.count = 5;
  expect(pattern.summary(event)).toContain("effective 10/15/2026, 5 times");
  expect(RecurrencePattern.fromEvent(newEvent()).summary(newEvent())).toBe("");
});
