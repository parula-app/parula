// @vitest-environment happy-dom
import "../../../logic/app"; // first, to resolve the import cycle around Abstract/Account.ts
import { Calendar } from "../../../logic/Calendar/Calendar";
import type { Event } from "../../../logic/Calendar/Event";
import { Participant } from "../../../logic/Calendar/Participant";
import { InvitationResponse } from "../../../logic/Calendar/Invitation/InvitationStatus";
import { Frequency } from "../../../logic/Calendar/RecurrenceRule";
import { DummyCalendarStorage } from "../../../logic/Calendar/SQL/DummyCalendarStorage";
import { CalendarActions } from "../../Calendar/CalendarActions";
import { selectedEvent } from "../../../frontend/Calendar/selected";
import { AppWindow } from "../../../frontend/MainWindow/AppWindow";
import { mockMessageBox } from "../Shared/Dialog/mockMessageBox";
import { beforeEach, expect, test } from "vitest";
import { get } from "svelte/store";

const messageBox = mockMessageBox();
beforeEach(() => {
  messageBox.mockReset();
  messageBox.mockResolvedValue(false);
});

function newCalendar(): Calendar {
  let calendar = new Calendar();
  calendar.name = "Team";
  calendar.storage = new DummyCalendarStorage();
  return calendar;
}

async function savedEvent(title = "Planning"): Promise<Event> {
  let calendar = newCalendar();
  let event = calendar.newEvent();
  event.title = title;
  event.startTime = new Date(2026, 9, 15, 10, 0);
  event.endTime = new Date(2026, 9, 15, 10, 30);
  calendar.events.add(event);
  await event.save();
  return event;
}

function makeMeeting(event: Event) {
  event.myParticipation = InvitationResponse.Organizer;
  event.participants.add(new Participant("me@example.com", "Me", InvitationResponse.Organizer));
  event.participants.add(new Participant("anna@example.com", "Anna", InvitationResponse.Accept));
}

test("Moving a meeting with attendees asks to send an update, and Cancel keeps the time", async () => {
  let event = await savedEvent();
  makeMeeting(event);
  await CalendarActions.changeTime(event, new Date(2026, 9, 15, 14, 0), new Date(2026, 9, 15, 14, 30));
  expect(messageBox).toHaveBeenCalledWith("Send Update",
    'Would you like to move the meeting "Planning" and send an update to the attendees?', "Send Update", "Cancel");
  expect(event.startTime).toEqual(new Date(2026, 9, 15, 10, 0));
});

test("Moving an appointment needs no question", async () => {
  let event = await savedEvent();
  await CalendarActions.changeTime(event, new Date(2026, 9, 15, 14, 0), new Date(2026, 9, 15, 14, 30));
  expect(messageBox).not.toHaveBeenCalled();
  expect(event.startTime).toEqual(new Date(2026, 9, 15, 14, 0));
});

test("Cancel Series of an own meeting asks about the cancellation, Delete Series of an appointment about the deletion", async () => {
  let meeting = await savedEvent("Weekly");
  makeMeeting(meeting);
  meeting.newRecurrenceRule(Frequency.Weekly);
  await CalendarActions.deleteSeries(meeting.instances.get(1));
  let appointment = await savedEvent("Gym");
  appointment.newRecurrenceRule(Frequency.Weekly);
  await CalendarActions.deleteSeries(appointment.instances.get(1));
  expect(messageBox.mock.calls.map(call => call.slice(0, 2))).toEqual([
    ["Cancel Series", 'Do you want to cancel all occurrences of the meeting "Weekly" and send a cancellation to all attendees?'],
    ["Delete Series", 'Do you want to delete all occurrences of the recurring appointment "Gym"?'],
  ]);
  expect(meeting.calendar.events.contains(meeting)).toBe(true);
  expect(appointment.calendar.events.contains(appointment)).toBe(true);
});

test("Cancel Meeting asks Yes / No, and No keeps the meeting", async () => {
  let event = await savedEvent();
  makeMeeting(event);
  await CalendarActions.deleteDefault(event);
  expect(messageBox).toHaveBeenCalledWith("Cancel Meeting",
    'Do you want to cancel the meeting "Planning" and send a cancellation to all attendees?', "Yes", "No");
  expect(event.calendar.events.contains(event)).toBe(true);
});

test("Delete Calendar says whether it deletes the calendar or only removes it from the app", async () => {
  let local = newCalendar();
  expect(local.protocol).toBe("calendar-local");
  expect(await CalendarActions.deleteCalendar(local)).toBe(false);
  let remote = newCalendar();
  Object.defineProperty(remote, "protocol", { value: "caldav" });
  expect(await CalendarActions.deleteCalendar(remote)).toBe(false);
  expect(messageBox.mock.calls.map(call => call[1])).toEqual([
    'Are you sure that you want to delete the calendar "Team" with all its appointments and meetings?',
    'Do you want to remove the calendar "Team" from Mustang? This does not change the calendar on the server.',
  ]);
});

// Stands in for a second main window. `acting` is what `AppWindow.current()` returns first.
class SecondMainWindow extends AppWindow {
  constructor() {
    super(window, "second");
  }
}

test("Deleting an event deselects it in every window that shows it, and keeps the selection of the others", async () => {
  let deleted = await savedEvent();
  let kept = await savedEvent("Lunch");
  let secondWindow = new SecondMainWindow();
  AppWindow.opened.add(secondWindow);
  try {
    secondWindow.uiState(selectedEvent).set(deleted);
    AppWindow.main.uiState(selectedEvent).set(kept);
    await CalendarActions.deleteOccurrence(deleted);
    expect(get(secondWindow.uiState(selectedEvent))).toBeNull();
    expect(get(AppWindow.main.uiState(selectedEvent))).toBe(kept);
  } finally {
    AppWindow.opened.remove(secondWindow);
  }
});

test("An event typed into the grid is selected in that window, also when another window is used while it saves", async () => {
  let secondWindow = new SecondMainWindow();
  AppWindow.opened.add(secondWindow);
  try {
    let selection = { start: new Date(2026, 9, 15, 9, 0), end: new Date(2026, 9, 15, 9, 30), allDay: false, calendar: newCalendar() };
    let saving: Promise<void>;
    AppWindow["acting"] = secondWindow;
    try {
      saving = CalendarActions.newEventWithTitle(selection, "Review");
    } finally {
      AppWindow["acting"] = null;
    }
    await saving;
    let created = get(secondWindow.uiState(selectedEvent));
    expect(created?.title).toBe("Review");
    expect(get(AppWindow.main.uiState(selectedEvent))).not.toBe(created);
  } finally {
    AppWindow.opened.remove(secondWindow);
  }
});
