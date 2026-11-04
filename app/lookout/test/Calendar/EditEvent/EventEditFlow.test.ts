// @vitest-environment happy-dom
import "../../../../logic/app"; // first, to resolve the import cycle around Abstract/Account.ts
import { Calendar } from "../../../../logic/Calendar/Calendar";
import type { Event } from "../../../../logic/Calendar/Event";
import { Participant } from "../../../../logic/Calendar/Participant";
import { PersonUID } from "../../../../logic/Abstract/PersonUID";
import { InvitationResponse } from "../../../../logic/Calendar/Invitation/InvitationStatus";
import { Frequency } from "../../../../logic/Calendar/RecurrenceRule";
import { DummyCalendarStorage } from "../../../../logic/Calendar/SQL/DummyCalendarStorage";
import { EventEditFlow } from "../../../Calendar/EditEvent/EventEditFlow";
import { EventTimeEditor } from "../../../Calendar/EditEvent/EventTimeEditor";
import { mockMessageBox } from "../../Shared/Dialog/mockMessageBox";
import { expectDaylightSavingTime } from "../../../../test/logic/Calendar/timeZone";
import { beforeEach, expect, test, vi } from "vitest";

// A time zone with daylight saving time, which changes on 2026-03-29 and 2026-10-25
test("The time zone has daylight saving time", () => {
  expectDaylightSavingTime();
});
// Answers the message boxes: Yes / OK, unless a test says otherwise
const messageBox = mockMessageBox();
beforeEach(() => {
  messageBox.mockReset();
  messageBox.mockResolvedValue(true);
});

function newCalendar(): Calendar {
  let calendar = new Calendar();
  calendar.storage = new DummyCalendarStorage();
  return calendar;
}

function newEvent(calendar = newCalendar(), start = new Date(2026, 9, 15, 10, 0)): Event {
  let event = calendar.newEvent();
  event.title = "Planning";
  event.startTime = start;
  event.endTime = new Date(start.getTime() + 30 * 60000);
  return event;
}

test("Title and times are needed", () => {
  let event = newEvent();
  event.startEditing();
  let flow = new EventEditFlow(event, () => {});
  expect(flow.missingPropsReason).toBe(null);
  event.title = "";
  expect(flow.hasMinimalProps).toBe(false);
  expect(flow.missingPropsReason).toBe("Please enter a title");
});

test("Attendees are the participants without the organizer", () => {
  let event = newEvent();
  event.myParticipation = InvitationResponse.Organizer;
  event.participants.add(new Participant("me@example.com", "Me", InvitationResponse.Organizer));
  event.participants.add(new Participant("anna@example.com", "Anna", InvitationResponse.Accept));
  let flow = new EventEditFlow(event, () => {});
  expect(flow.isMeeting).toBe(true);
  expect(flow.willSend).toBe(true);
  expect(flow.attendees.map(attendee => attendee.name)).toEqual(["Anna"]);
});

test("Save adds a new appointment to its calendar, saves and closes the form", async () => {
  let event = newEvent();
  event.startEditing();
  let onClosed = vi.fn();
  let flow = new EventEditFlow(event, onClosed);
  event.title = "Planning session";
  expect(flow.hasChanges).toBe(true);
  expect(flow.needsSeriesChoice).toBe(false);
  await flow.saveWith(null);
  expect(event.calendar.events.contains(event)).toBe(true);
  expect(event.unedited).toBeFalsy();
  expect(onClosed).toHaveBeenCalledOnce();
});

test("Cancel reverts the changes", () => {
  let event = newEvent();
  event.startEditing();
  let flow = new EventEditFlow(event, () => {});
  event.title = "Something else";
  flow.cancel();
  expect(event.title).toBe("Planning");
});

test("An occurrence asks which part of the series to change", async () => {
  let calendar = newCalendar();
  let master = newEvent(calendar);
  master.newRecurrenceRule(Frequency.Weekly);
  calendar.events.add(master);
  await master.save();
  let occurrence = master.instances.get(2);
  occurrence.startEditing();
  let flow = new EventEditFlow(occurrence, () => {});
  expect(flow.needsSeriesChoice).toBe(false);
  occurrence.title = "Planning, moved";
  expect(flow.needsSeriesChoice).toBe(true);
  expect(flow.seriesChoices()).toEqual(["occurrence", "following", "series"]);

  let first = master.instances.get(0);
  first.startEditing();
  first.title = "First planning";
  expect(new EventEditFlow(first, () => {}).seriesChoices()).toEqual(["occurrence", "series"]);
  first.cancelEditing();
});

test("A changed series end allows to save the series, from an occurrence", async () => {
  let calendar = newCalendar();
  let master = newEvent(calendar);
  master.newRecurrenceRule(Frequency.Weekly);
  calendar.events.add(master);
  await master.save();
  let occurrence = master.instances.get(1);
  occurrence.startEditing();
  let flow = new EventEditFlow(occurrence, () => {});
  expect(flow.canSaveSeries).toBe(false);
  flow.pattern.end = "count";
  flow.pattern.count = 5;
  expect(flow.seriesEndChanged).toBe(true);
  expect(flow.canSaveSeries).toBe(true);
  expect(flow.seriesChoices()).toEqual(["following", "series"]);
  await flow.saveWith("series");
  expect(master.recurrenceRule.count).toBe(5);
  expect(master.startTime).toEqual(new Date(2026, 9, 15, 10, 0));
});

async function savedWeeklySeries(): Promise<Event> {
  let calendar = newCalendar();
  let master = newEvent(calendar); // Thursday
  master.location = "Room 1";
  master.newRecurrenceRule(Frequency.Weekly, 1, 0, [1, 4]);
  calendar.events.add(master);
  await master.save();
  return master;
}

test("A changed title for the entire series, from an occurrence, keeps the series start and its times", async () => {
  let master = await savedWeeklySeries();
  let occurrence = master.instances.get(3);
  occurrence.startEditing();
  occurrence.title = "Weekly planning";
  await new EventEditFlow(occurrence, () => {}).saveWith("series");
  expect(messageBox).not.toHaveBeenCalled();
  expect(master.title).toBe("Weekly planning");
  expect(master.startTime).toEqual(new Date(2026, 9, 15, 10, 0));
  expect(master.recurrenceRule.getOccurrenceByIndex(0)).toEqual(new Date(2026, 9, 15, 10, 0));
  expect(master.recurrenceRule.weekdays.sort()).toEqual([1, 4]);
});

test("A later time and another day of an occurrence, for the entire series, move all occurrences", async () => {
  let master = await savedWeeklySeries();
  let occurrence = master.instances.contents.find(instance => instance.startTime.getDay() == 4 && instance.startTime > master.startTime);
  occurrence.startEditing();
  let moved = new Date(occurrence.startTime);
  moved.setDate(moved.getDate() + 1);
  moved.setHours(14, 0);
  occurrence.startTime = moved;
  occurrence.endTime = new Date(moved.getTime() + 60 * 60000);
  occurrence.alarm = new Date(moved.getTime() - 15 * 60000);
  await new EventEditFlow(occurrence, () => {}).saveWith("series");
  expect(master.startTime).toEqual(new Date(2026, 9, 16, 14, 0));
  expect(master.endTime).toEqual(new Date(2026, 9, 16, 15, 0));
  expect(master.alarm).toEqual(new Date(2026, 9, 16, 13, 45));
  expect(master.location).toBe("Room 1");
  expect(master.recurrenceRule.weekdays.sort()).toEqual([2, 5]);
});

async function savedSeries(start: Date, frequency: Frequency, allDay = false): Promise<Event> {
  let calendar = newCalendar();
  let master = newEvent(calendar, start);
  if (allDay) {
    master.allDay = true;
    master.endTime = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
  }
  master.newRecurrenceRule(frequency);
  calendar.events.add(master);
  await master.save();
  return master;
}

function occurrenceOn(master: Event, day: Date): Event {
  let occurrence = master.instances.contents.find(instance => instance.startTime.toDateString() == day.toDateString());
  occurrence.startEditing();
  return occurrence;
}

test("A later time of a summer occurrence, for the entire series, moves the winter start to the same time of day", async () => {
  let master = await savedSeries(new Date(2026, 2, 19, 10, 0), Frequency.Weekly);
  let occurrence = occurrenceOn(master, new Date(2026, 3, 2));
  new EventTimeEditor(occurrence).setStart(new Date(2026, 3, 2, 11, 0));
  await new EventEditFlow(occurrence, () => {}).saveWith("series");
  expect(master.startTime).toEqual(new Date(2026, 2, 19, 11, 0));
  expect(master.endTime).toEqual(new Date(2026, 2, 19, 11, 30));
  expect(master.recurrenceRule.getOccurrenceByIndex(2)).toEqual(new Date(2026, 3, 2, 11, 0));
});

test("Moving an occurrence to the next day across the change to summer time moves the series by one day", async () => {
  expect(new Date(2026, 2, 28).getTimezoneOffset()).not.toBe(new Date(2026, 2, 30).getTimezoneOffset());
  let master = await savedSeries(new Date(2026, 2, 20, 10, 0), Frequency.Daily);
  let occurrence = occurrenceOn(master, new Date(2026, 2, 28));
  new EventTimeEditor(occurrence).setStartDate(new Date(2026, 2, 29));
  expect(occurrence.startTime).toEqual(new Date(2026, 2, 29, 10, 0));
  await new EventEditFlow(occurrence, () => {}).saveWith("series");
  expect(master.startTime).toEqual(new Date(2026, 2, 21, 10, 0));
  expect(master.recurrenceRule.getOccurrenceByIndex(8)).toEqual(new Date(2026, 2, 29, 10, 0));
});

test("A moved exception, for the entire series, moves the series by the same days and minutes", async () => {
  let master = await savedWeeklySeries(); // Monday and Thursday at 10:00
  let exception = master.instances.get(2);
  exception.startEditing();
  new EventTimeEditor(exception).setStart(new Date(exception.startTime.getFullYear(), exception.startTime.getMonth(), exception.startTime.getDate(), 14, 0));
  await new EventEditFlow(exception, () => {}).saveWith("occurrence");
  expect(master.exceptions.contents).toContain(exception);

  exception.startEditing();
  new EventTimeEditor(exception).setStart(new Date(exception.startTime.getTime() + 24 * 60 * 60000 + 30 * 60000));
  let flow = new EventEditFlow(exception, () => {});
  flow.pattern.end = "count";
  flow.pattern.count = 20;
  expect(flow.seriesChoices()).toContain("series");
  await flow.saveWith("series");
  expect(master.startTime).toEqual(new Date(2026, 9, 16, 10, 30));
  expect(master.recurrenceRule.weekdays.sort()).toEqual([2, 5]);
  expect(master.recurrenceRule.count).toBe(20);
});

test("Only a new title for the entire series keeps the times and the exceptions", async () => {
  let master = await savedWeeklySeries();
  let exception = master.instances.get(2);
  exception.startEditing();
  exception.location = "Room 2";
  await new EventEditFlow(exception, () => {}).saveWith("occurrence");
  let occurrence = master.instances.get(4);
  occurrence.startEditing();
  occurrence.title = "Weekly planning";
  occurrence.alarm = new Date(occurrence.startTime.getTime() - 10 * 60000);
  await new EventEditFlow(occurrence, () => {}).saveWith("series");
  expect(master.startTime).toEqual(new Date(2026, 9, 15, 10, 0));
  expect(master.endTime).toEqual(new Date(2026, 9, 15, 10, 30));
  expect(master.alarm).toEqual(new Date(2026, 9, 15, 9, 50));
  expect(master.exceptions.contents).toContain(exception);
});

test("An all-day occurrence moved by a day, for the entire series, keeps the series all day", async () => {
  let master = await savedSeries(new Date(2026, 2, 26), Frequency.Weekly, true);
  let occurrence = occurrenceOn(master, new Date(2026, 3, 2));
  new EventTimeEditor(occurrence).setStartDate(new Date(2026, 3, 3));
  await new EventEditFlow(occurrence, () => {}).saveWith("series");
  expect(master.allDay).toBe(true);
  expect(master.startTime).toEqual(new Date(2026, 2, 27));
  expect(master.endTime).toEqual(new Date(2026, 2, 28));
  expect(master.recurrenceRule.weekdays).toEqual([5]);
  expect(master.recurrenceRule.getOccurrenceByIndex(1)).toEqual(new Date(2026, 3, 3));
});

test("All day for an occurrence, for the entire series, makes the series all day", async () => {
  let master = await savedSeries(new Date(2026, 9, 15, 10, 0), Frequency.Weekly);
  let occurrence = occurrenceOn(master, new Date(2026, 9, 29));
  new EventTimeEditor(occurrence).setAllDay(true);
  await new EventEditFlow(occurrence, () => {}).saveWith("series");
  expect(master.allDay).toBe(true);
  expect(master.startTime).toEqual(new Date(2026, 9, 15));
  expect(master.endTime).toEqual(new Date(2026, 9, 16));
});

test("This and following occurrences take the time that the recurrence dialog set for the series", async () => {
  let master = await savedSeries(new Date(2026, 9, 15, 10, 0), Frequency.Weekly);
  let occurrence = occurrenceOn(master, new Date(2026, 10, 5));
  occurrence.alarm = new Date(occurrence.startTime.getTime() - 15 * 60000);
  let flow = new EventEditFlow(occurrence, () => {});
  // What the recurrence dialog does on OK
  master.startEditing();
  let seriesTimes = new EventTimeEditor(master);
  seriesTimes.setStart(new Date(2026, 9, 15, 11, 0));
  seriesTimes.setEnd(new Date(2026, 9, 15, 12, 0));
  flow.applyPattern(flow.pattern);
  expect(flow.seriesChoices()).toEqual(["occurrence", "following", "series"]);
  await flow.saveWith("following");
  let following = master.calendar.events.contents.find(event => event != master && event.recurrenceRule);
  expect(following.startTime).toEqual(new Date(2026, 10, 5, 11, 0));
  expect(following.endTime).toEqual(new Date(2026, 10, 5, 12, 0));
  expect(following.alarm).toEqual(new Date(2026, 10, 5, 10, 45));
  expect(master.startTime).toEqual(new Date(2026, 9, 15, 10, 0));
  expect(master.recurrenceRule.count).toBe(3);
});

test("A series with another time and day from the Scheduling Assistant moves its recurrence", async () => {
  let master = await savedSeries(new Date(2026, 9, 15, 10, 0), Frequency.Weekly);
  master.startEditing();
  let flow = new EventEditFlow(master, () => {});
  let times = new EventTimeEditor(master);
  times.moveTo(new Date(2026, 9, 16, 11, 0));
  times.setEnd(new Date(2026, 9, 16, 12, 0));
  await flow.saveWith(null);
  expect(master.recurrenceRule.weekdays).toEqual([5]);
  expect(master.recurrenceRule.getOccurrenceByIndex(0)).toEqual(new Date(2026, 9, 16, 11, 0));
  expect(master.recurrenceRule.getOccurrenceByIndex(1)).toEqual(new Date(2026, 9, 23, 11, 0));
  expect(master.instances.get(1).endTime).toEqual(new Date(2026, 9, 23, 12, 0));
});

test("A series time from the Scheduling Assistant after the recurrence dialog keeps the dialog's weekdays", async () => {
  let event = newEvent(newCalendar(), new Date(2026, 9, 15, 10, 0)); // Thursday
  event.startEditing();
  let flow = new EventEditFlow(event, () => {});
  let pattern = flow.pattern.clone();
  pattern.weekdays = [1, 4];
  flow.applyPattern(pattern);
  new EventTimeEditor(event).setStart(new Date(2026, 9, 15, 14, 0));
  await flow.saveWith(null);
  expect(event.recurrenceRule.weekdays.sort()).toEqual([1, 4]);
  expect(event.recurrenceRule.getOccurrenceByIndex(1)).toEqual(new Date(2026, 9, 19, 14, 0));
});

test("A series with only a new title keeps its recurrence and exceptions", async () => {
  let master = await savedWeeklySeries();
  let exception = master.instances.get(2);
  exception.startEditing();
  exception.location = "Room 2";
  await new EventEditFlow(exception, () => {}).saveWith("occurrence");
  let rule = master.recurrenceRule;
  master.startEditing();
  master.title = "Weekly planning";
  await new EventEditFlow(master, () => {}).saveWith(null);
  expect(messageBox).not.toHaveBeenCalled();
  expect(master.recurrenceRule).toBe(rule);
  expect(master.exceptions.contents).toContain(exception);
});

test("A series end with a time of day from the server is no change", async () => {
  let master = await savedSeries(new Date(2026, 9, 15, 10, 0), Frequency.Weekly);
  await master.setRecurrenceEndTime(new Date(2026, 11, 17, 9, 0));
  await master.save();
  let occurrence = master.instances.get(1);
  occurrence.startEditing();
  let flow = new EventEditFlow(occurrence, () => {});
  expect(flow.pattern.end).toBe("date");
  expect(flow.seriesEndChanged).toBe(false);
  expect(flow.hasChanges).toBe(false);
  expect(flow.needsSeriesChoice).toBe(false);
  flow.pattern.endDate = new Date(2026, 11, 24);
  expect(flow.seriesEndChanged).toBe(true);
});

test("Deleting an occurrence excludes it from the series and closes the form", async () => {
  let master = await savedWeeklySeries();
  let occurrence = master.instances.get(2);
  let start = occurrence.recurrenceStartTime;
  occurrence.startEditing();
  let onClosed = vi.fn();
  await new EventEditFlow(occurrence, onClosed).deleteIt();
  expect(master.exclusions.contents.map(date => date.getTime())).toContain(start.getTime());
  expect(master.instances.contents.some(instance => instance.startTime.getTime() == start.getTime())).toBe(false);
  expect(onClosed).toHaveBeenCalledOnce();
});

test("Deleting this and the following occurrences ends the series before it", async () => {
  let master = await savedWeeklySeries();
  let occurrence = master.instances.get(3);
  occurrence.startEditing();
  await new EventEditFlow(occurrence, () => {}).deleteRemainder();
  expect(master.recurrenceRule.count).toBe(3);
});

test("Deleting the entire series asks first", async () => {
  let master = await savedWeeklySeries();
  let occurrence = master.instances.get(3);
  occurrence.startEditing();
  let onClosed = vi.fn();
  messageBox.mockResolvedValueOnce(false);
  await new EventEditFlow(occurrence, onClosed).deleteAll();
  expect(messageBox.mock.calls[0].slice(0, 2)).toEqual(["Delete Series", 'Do you want to delete all occurrences of the recurring appointment "Planning"?']);
  expect(master.calendar.events.contains(master)).toBe(true);
  expect(onClosed).not.toHaveBeenCalled();
  await new EventEditFlow(occurrence, onClosed).deleteAll();
  expect(master.calendar.events.contains(master)).toBe(false);
  expect(onClosed).toHaveBeenCalledOnce();
});

test("Days between dates, also across a change to daylight saving time", () => {
  expect(EventEditFlow.daysBetween(new Date(2026, 2, 28, 23, 0), new Date(2026, 2, 30, 1, 0))).toBe(2);
  expect(EventEditFlow.daysBetween(new Date(2026, 9, 16), new Date(2026, 9, 15))).toBe(-1);
});

test("Removing the recurrence makes the series single again", () => {
  let event = newEvent();
  event.newRecurrenceRule(Frequency.Daily);
  event.startEditing();
  let flow = new EventEditFlow(event, () => {});
  flow.removeRecurrence();
  expect(event.recurrenceRule).toBe(null);
  expect(flow.pattern.end).toBe("none");
});

test("Select Names sets the attendees and keeps the organizer", () => {
  let event = newEvent();
  event.startEditing();
  event.myParticipation = InvitationResponse.Organizer;
  event.participants.add(new Participant("me@example.com", "Me", InvitationResponse.Organizer));
  event.participants.add(new Participant("anna@example.com", "Anna", InvitationResponse.Accept));
  event.participants.add(new Participant("bert@example.com", "Bert", InvitationResponse.Tentative));
  let flow = new EventEditFlow(event, () => {});
  flow.setAttendees([new PersonUID("bert@example.com", "Bert"), new PersonUID("cleo@example.com", "Cleo")]);
  expect(event.participants.contents.map(participant => participant.emailAddress))
    .toEqual(["me@example.com", "bert@example.com", "cleo@example.com"]);
  expect(event.participants.find(participant => participant.emailAddress == "bert@example.com").response)
    .toBe(InvitationResponse.Tentative);
  expect(flow.attendees.map(participant => participant.name)).toEqual(["Bert", "Cleo"]);
});

test("Removing the recurrence of a saved series asks first, and No keeps the form open", async () => {
  let master = await savedSeries(new Date(2026, 9, 15, 10, 0), Frequency.Weekly);
  master.startEditing();
  let onClosed = vi.fn();
  let flow = new EventEditFlow(master, onClosed);
  flow.removeRecurrence();
  messageBox.mockResolvedValueOnce(false);
  await flow.saveWith(null);
  expect(messageBox).toHaveBeenCalledOnce();
  expect(messageBox.mock.calls[0][0]).toBe("Remove Recurrence");
  expect(onClosed).not.toHaveBeenCalled();
  expect(master.unedited?.recurrenceRule).toBeTruthy();

  await flow.saveWith(null);
  expect(master.recurrenceRule).toBe(null);
  expect(onClosed).toHaveBeenCalledOnce();
});

test("A new pattern for the entire series warns that the exceptions are lost; Cancel keeps them and the form", async () => {
  let master = await savedWeeklySeries(); // Monday and Thursday at 10:00
  let exception = master.instances.get(2);
  exception.startEditing();
  exception.location = "Room 2";
  await new EventEditFlow(exception, () => {}).saveWith("occurrence");
  let occurrence = master.instances.get(4);
  occurrence.startEditing();
  let onClosed = vi.fn();
  let flow = new EventEditFlow(occurrence, onClosed);
  let pattern = flow.pattern.clone();
  pattern.weekdays = [2];
  flow.applyPattern(pattern);
  messageBox.mockResolvedValueOnce(false);
  await flow.saveWith("series");
  expect(messageBox.mock.calls[0][1]).toBe("Any exceptions associated with this recurring appointment will be lost. Is this OK?");
  expect(onClosed).not.toHaveBeenCalled();
  expect(master.exceptions.contents).toContain(exception);
});

test("Cancel Meeting and Cancel Series ask before they send the cancellations", async () => {
  let master = await savedWeeklySeries();
  let occurrence = master.instances.get(3);
  occurrence.startEditing();
  let onClosed = vi.fn();
  messageBox.mockResolvedValue(false);
  await new EventEditFlow(occurrence, onClosed).cancelMeeting();
  await new EventEditFlow(occurrence, onClosed).cancelMeetingSeries();
  expect(messageBox.mock.calls.map(call => call[0])).toEqual(["Cancel Meeting", "Cancel Series"]);
  expect(messageBox.mock.calls[0][1]).toBe('Do you want to cancel this occurrence of the meeting "Planning" and send a cancellation to all attendees?');
  expect(messageBox.mock.calls.map(call => call.slice(2))).toEqual([["Yes", "No"], ["Yes", "No"]]);
  expect(master.calendar.events.contains(master)).toBe(true);
  expect(onClosed).not.toHaveBeenCalled();

  messageBox.mockResolvedValue(true);
  await new EventEditFlow(occurrence, onClosed).cancelMeetingSeries();
  expect(master.calendar.events.contains(master)).toBe(false);
  expect(onClosed).toHaveBeenCalledOnce();
});
