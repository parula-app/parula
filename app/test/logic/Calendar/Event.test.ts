import '../../../logic/app'; // Import first, to set up the module graph and dodge the Account import cycle
import { expectDaylightSavingTime } from './timeZone';
import { describe, expect, test } from 'vitest';
import { Event, RecurrenceCase } from '../../../logic/Calendar/Event';
import { Calendar } from '../../../logic/Calendar/Calendar';
import { Frequency, RecurrenceRule } from '../../../logic/Calendar/RecurrenceRule';
import { k1HourMS } from '../../../logic/util/date';

function dailyMaster(): Event {
  let master = new Event();
  master.startTime = new Date(2020, 0, 1, 9, 0);
  master.endTime = new Date(2020, 0, 1, 10, 0);
  master.recurrenceRule = new RecurrenceRule({
    masterDuration: 36e5,
    seriesStartTime: master.startTime,
    frequency: Frequency.Daily,
  });
  return master;
}

// #1186: Exchange (and other servers) can report a deleted occurrence whose
// date doesn't line up with our computed recurrence. This used to throw an
// assertion during sync ("occurrence date not in recurrence") and drop the
// whole recurring event.
test("Deleted occurrence not in the recurrence is ignored, not fatal - #1186", () => {
  let master = dailyMaster();
  // Occurrences are at 09:00; 09:30 matches none of them.
  let bogus = new Date(2020, 0, 5, 9, 30);
  expect(master.recurrenceRule.getIndexOfOccurrence(bogus)).toBe(-1);
  expect(() => (master as any).makeExclusionLocally(bogus)).not.toThrow();
  // Nothing to exclude, so no phantom exclusion is recorded (a -1 index
  // wouldn't survive the round-trip through the database anyway).
  expect(master.exclusions.length).toBe(0);
});

test("Genuine occurrence dates are still recognised for exclusion - #1186", () => {
  let master = dailyMaster();
  let valid = new Date(2020, 0, 5, 9, 0);
  // The guard must not swallow real deletions: this date is a real occurrence.
  expect(master.recurrenceRule.getIndexOfOccurrence(valid)).not.toBe(-1);
});

/* copyFrom() gave the copy the same Date objects as the original,
 * so changing a date of the copy in place changed the original event, too. */
test("Changing a date of a copy doesn't change the original event", () => {
  let master = dailyMaster();
  master.alarm = new Date(2020, 0, 1, 8, 45);
  master.lastUpdateTime = new Date(2019, 11, 1);
  master.exclusions.add(new Date(2020, 0, 5, 9, 0));
  let exception = new Event(undefined, master);
  exception.recurrenceCase = RecurrenceCase.Exception;
  exception.recurrenceStartTime = new Date(2020, 0, 3, 9, 0);
  exception.startTime = new Date(2020, 0, 3, 11, 0);
  exception.endTime = new Date(2020, 0, 3, 12, 0);

  function datesOf(event: Event): Date[] {
    return [event.startTime, event.endTime, event.alarm, event.lastUpdateTime, event.recurrenceStartTime, ...event.exclusions.contents]
      .filter(date => date);
  }
  for (let original of [master, exception]) {
    let copy = new Event();
    copy.copyFrom(original);
    let originalTimes = datesOf(original).map(date => date.getTime());
    expect(datesOf(copy).map(date => date.getTime())).toEqual(originalTimes);
    for (let date of datesOf(copy)) {
      date.setTime(date.getTime() + k1HourMS);
    }
    expect(datesOf(original).map(date => date.getTime())).toEqual(originalTimes);
  }
});

/** #1405: The event dialog showed the event twice: once from the calendar,
 * and once as proposal, because we didn't check whether it's already there. */
test("The same meeting in another calendar or invitation is the same event", () => {
  let invitation = new Event();
  invitation.calUID = "meeting-1";
  let inCalendar = new Event();
  inCalendar.calUID = "meeting-1";
  let otherMeeting = new Event();
  otherMeeting.calUID = "meeting-2";

  expect(invitation.isSameUID(invitation)).toBe(true);
  expect(invitation.isSameUID(inCalendar)).toBe(true);
  expect(invitation.isSameUID(otherMeeting)).toBe(false);
  expect(invitation.isSameUID(null)).toBe(false);
});

test("New events without calUID are not the same event", () => {
  let event = new Event();
  let otherEvent = new Event();

  expect(event.isSameUID(otherEvent)).toBe(false);
  expect(event.isSameUID(event)).toBe(true);
});

/* On the days when the clocks change, a day has 25 or 23 hours.
 * The duration of an all-day event was the elapsed time rounded up to whole days,
 * so an all-day event on the day the clocks go back was 2 days long, and became
 * 2 days long when the event form moved it to another start date.
 * The dates are created within the tests, after the time zone has been set. */
describe("All-day events on the days when the clocks change", () => {
  test("The time zone has daylight saving time", () => {
    expectDaylightSavingTime();
  });

  function allDayEvent(startTime: Date, days = 1): Event {
    let event = new Event();
    event.allDay = true;
    event.startTime = startTime;
    event.endTime = new Date(startTime);
    event.endTime.setDate(startTime.getDate() + days);
    return event;
  }

  /** What the event form does when the user picks another start date */
  function changeStartDate(event: Event, startTime: Date) {
    let duration = event.duration;
    event.startTime = startTime;
    event.duration = duration;
  }

  test("The time zone has clock changes on these days", () => {
    expect(new Date(2026, 9, 26).getTime() - new Date(2026, 9, 25).getTime()).toBe(25 * k1HourMS);
    expect(new Date(2026, 2, 30).getTime() - new Date(2026, 2, 29).getTime()).toBe(23 * k1HourMS);
  });

  test("All-day event on the day the clocks go back is 1 day long", () => {
    let event = allDayEvent(new Date(2026, 9, 25));
    expect(event.durationDays).toBe(1);
  });

  test("All-day event on the day the clocks go forward is 1 day long", () => {
    let event = allDayEvent(new Date(2026, 2, 29));
    expect(event.durationDays).toBe(1);
  });

  test("All-day events over several days count the days across the clock change", () => {
    expect(allDayEvent(new Date(2026, 9, 24), 3).durationDays).toBe(3);
    expect(allDayEvent(new Date(2026, 2, 28), 3).durationDays).toBe(3);
  });

  test("All-day event that ends 1 second before midnight still counts the whole day", () => {
    // Older versions stored all-day events like this
    let event = allDayEvent(new Date(2026, 9, 25), 0);
    event.endTime = new Date(2026, 9, 25, 23, 59, 59);
    expect(event.durationDays).toBe(1);
  });

  test("Moving an all-day event away from the day the clocks go back keeps it 1 day long", () => {
    let event = allDayEvent(new Date(2026, 9, 25));
    changeStartDate(event, new Date(2026, 9, 26));
    expect(event.endTime.getTime()).toBe(new Date(2026, 9, 27).getTime());
    expect(event.durationDays).toBe(1);
  });

  test("Moving an all-day event onto the day the clocks go back keeps it 1 day long", () => {
    let event = allDayEvent(new Date(2026, 9, 24));
    changeStartDate(event, new Date(2026, 9, 25));
    expect(event.endTime.getTime()).toBe(new Date(2026, 9, 26).getTime());
    expect(event.durationDays).toBe(1);
  });

  test("Moving an all-day event away from the day the clocks go forward keeps it 1 day long", () => {
    let event = allDayEvent(new Date(2026, 2, 29));
    changeStartDate(event, new Date(2026, 2, 30));
    expect(event.endTime.getTime()).toBe(new Date(2026, 2, 31).getTime());
    expect(event.durationDays).toBe(1);
  });

  test("Moving an all-day event onto the day the clocks go forward keeps it 1 day long", () => {
    let event = allDayEvent(new Date(2026, 2, 28));
    changeStartDate(event, new Date(2026, 2, 29));
    expect(event.endTime.getTime()).toBe(new Date(2026, 2, 30).getTime());
    expect(event.durationDays).toBe(1);
  });

  function weeklyAllDaySeries(startTime: Date): Event {
    let calendar = new Calendar();
    let master = calendar.newEvent();
    master.allDay = true;
    master.startTime = startTime;
    master.endTime = new Date(startTime);
    master.endTime.setDate(startTime.getDate() + 1);
    master.recurrenceRule = new RecurrenceRule({
      masterDuration: master.duration,
      seriesStartTime: master.startTime,
      frequency: Frequency.Weekly,
      count: 2,
    });
    return master;
  }

  test("Occurrences of an all-day series end at midnight after a clock change", () => {
    for (let [seriesStart, occurrenceStart] of [
      [new Date(2026, 9, 18), new Date(2026, 9, 25)], // occurrence on the day the clocks go back
      [new Date(2026, 9, 25), new Date(2026, 10, 1)], // series starts on that day
      [new Date(2026, 2, 22), new Date(2026, 2, 29)], // occurrence on the day the clocks go forward
      [new Date(2026, 2, 29), new Date(2026, 3, 5)], // series starts on that day
    ]) {
      let master = weeklyAllDaySeries(seriesStart);
      let occurrence = master.instances.get(1);
      expect(occurrence.startTime.getTime()).toBe(occurrenceStart.getTime());
      let nextDay = new Date(occurrenceStart);
      nextDay.setDate(occurrenceStart.getDate() + 1);
      expect(occurrence.endTime.getTime()).toBe(nextDay.getTime());
      expect(occurrence.durationDays).toBe(1);
    }
  });
});
