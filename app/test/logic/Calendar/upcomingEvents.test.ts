// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../logic/app";
import { Calendar } from "../../../logic/Calendar/Calendar";
import { Event } from "../../../logic/Calendar/Event";
import { Frequency, RecurrenceRule } from "../../../logic/Calendar/RecurrenceRule";
import { expect, test } from "vitest";

const k1HourMS = 3600 * 1000;
const k1DayMS = 24 * k1HourMS;

class TestEvent extends Event {
  declare calendar: TestCalendar;

  protected async downloadAttachmentsFromServer(): Promise<void> {
    for (let attachment of this.attachments) {
      this.calendar.downloaded.push(attachment.filename);
      attachment.content = new File(["contents"], attachment.filename);
    }
  }
}

class TestCalendar extends Calendar {
  /** What the server was asked for, in order */
  readonly downloaded: string[] = [];

  newEvent(parentEvent?: TestEvent): TestEvent {
    return new TestEvent(this, parentEvent);
  }

  protected async listEventsFromServer(): Promise<void> {
    this.downloaded.push("event details");
  }
}

function newTestCalendar(): TestCalendar {
  let calendar = new TestCalendar();
  calendar.name = "Test";
  calendar.dbID = 1; // so that we don't need a database
  return calendar;
}

/** @param startsInHours relative to now, may be negative */
function newTestEvent(calendar: TestCalendar, filename: string, startsInHours: number): TestEvent {
  let event = calendar.newEvent();
  event.title = filename;
  event.startTime = new Date(Date.now() + startsInHours * k1HourMS);
  event.endTime = new Date(event.startTime.getTime() + k1HourMS);
  let attachment = event.newAttachment();
  attachment.filename = filename;
  attachment.pID = filename; // it's on the server, but not downloaded yet
  event.attachments.add(attachment);
  calendar.events.add(event);
  return event;
}

test("An event is upcoming until it has ended", () => {
  let calendar = newTestCalendar();

  expect(newTestEvent(calendar, "over.pdf", -3).isUpcoming()).toBe(false);
  expect(newTestEvent(calendar, "running.pdf", -0.5).isUpcoming()).toBe(true);
  expect(newTestEvent(calendar, "later.pdf", 3).isUpcoming()).toBe(true);
});

test("A recurring event is upcoming while occurrences are still to come", () => {
  let lastYear = new Date(Date.now() - 365 * k1DayMS);
  // No calendar, so that we don't generate a year of instances
  let stillRunning = new Event();
  stillRunning.startTime = lastYear;
  stillRunning.endTime = new Date(lastYear.getTime() + k1HourMS);
  stillRunning.recurrenceRule = new RecurrenceRule({
    masterDuration: 3600,
    seriesStartTime: lastYear,
    frequency: Frequency.Weekly,
  });
  expect(stillRunning.isUpcoming()).toBe(true);

  let ended = new Event();
  ended.startTime = lastYear;
  ended.endTime = new Date(lastYear.getTime() + k1HourMS);
  ended.recurrenceRule = new RecurrenceRule({
    masterDuration: 3600,
    seriesStartTime: lastYear,
    frequency: Frequency.Weekly,
    count: 3,
  });
  expect(ended.isUpcoming()).toBe(false);
});

test("listEvents() downloads the event details first, then the attachments of the upcoming events", async () => {
  let calendar = newTestCalendar();
  newTestEvent(calendar, "over.pdf", -3);
  newTestEvent(calendar, "later.pdf", 3);

  await calendar.listEvents();

  expect(calendar.downloaded).toEqual(["event details", "later.pdf"]);
});

test("Attachments that we already have are not downloaded again", async () => {
  let calendar = newTestCalendar();
  let event = newTestEvent(calendar, "later.pdf", 3);

  await calendar.listEvents();
  expect(calendar.downloaded).toEqual(["event details", "later.pdf"]);

  // e.g. the next poll for changes
  await calendar.listEvents();
  expect(calendar.downloaded).toEqual(["event details", "later.pdf", "event details"]);
  expect(event.attachments.first.content).toBeTruthy();
});
