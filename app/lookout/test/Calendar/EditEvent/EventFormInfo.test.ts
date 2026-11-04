// @vitest-environment happy-dom
import "../../../../logic/app"; // first, to resolve the import cycle around Abstract/Account.ts
import { Calendar } from "../../../../logic/Calendar/Calendar";
import type { Event } from "../../../../logic/Calendar/Event";
import { Participant } from "../../../../logic/Calendar/Participant";
import { InvitationResponse } from "../../../../logic/Calendar/Invitation/InvitationStatus";
import { Frequency } from "../../../../logic/Calendar/RecurrenceRule";
import { DummyCalendarStorage } from "../../../../logic/Calendar/SQL/DummyCalendarStorage";
import { eventTabLabel, responseCounts, responseSummary, eventWhenText, sortForTracking, eventConflict, eventInfoMessages } from "../../../Calendar/EditEvent/EventFormInfo";
import { RecurrencePattern } from "../../../Calendar/EditEvent/RecurrencePattern";
import { expect, test } from "vitest";

const calendar = new Calendar();
calendar.storage = new DummyCalendarStorage();

function newEvent(start = new Date(2026, 9, 15, 10, 0), minutes = 30, title = "Planning"): Event {
  let event = calendar.newEvent();
  event.title = title;
  event.startTime = start;
  event.endTime = new Date(start.getTime() + minutes * 60000);
  return event;
}

function organize(event: Event, ...responses: InvitationResponse[]) {
  event.myParticipation = InvitationResponse.Organizer;
  event.participants.add(new Participant("me@example.com", "Me", InvitationResponse.Organizer));
  responses.forEach((response, i) => event.participants.add(new Participant(`p${i}@example.com`, `Person ${i}`, response)));
}

function plain(text: string): string {
  return text.replace(/\s/g, " ");
}

function invite(event: Event, myResponse: InvitationResponse) {
  event.myParticipation = myResponse;
  event.participants.add(new Participant("boss@example.com", "Boss", InvitationResponse.Organizer));
  event.participants.add(new Participant("me@example.com", "Me", myResponse));
}

test("Tab label: appointment, meeting, series and occurrence", () => {
  let event = newEvent();
  expect(eventTabLabel(event)).toBe("Appointment");
  organize(event, InvitationResponse.Unknown);
  expect(eventTabLabel(event)).toBe("Meeting");
  event.newRecurrenceRule(Frequency.Weekly);
  expect(eventTabLabel(event)).toBe("Meeting Series");
  expect(eventTabLabel(event.instances.get(1))).toBe("Meeting Occurrence");

  let single = newEvent();
  single.newRecurrenceRule(Frequency.Daily);
  expect(eventTabLabel(single)).toBe("Appointment Series");
});

test("Response summary for the organizer, like Outlook", () => {
  let event = newEvent();
  organize(event, InvitationResponse.NoResponseReceived, InvitationResponse.NoResponseReceived);
  expect(responseSummary(event)).toBe("No responses have been received for this meeting");
  event.participants.get(1).response = InvitationResponse.Accept;
  event.participants.get(2).response = InvitationResponse.Tentative;
  expect(responseCounts(event)).toEqual({ accepted: 1, tentative: 1, declined: 0, none: 0 });
  expect(responseSummary(event)).toBe("Attendee responses: 1 accepted, 1 tentatively accepted, 0 declined");
});

test("Conflicts and adjacent appointments", () => {
  let event = newEvent(new Date(2026, 9, 15, 10, 0), 60);
  let before = newEvent(new Date(2026, 9, 15, 9, 0), 60);
  let overlapping = newEvent(new Date(2026, 9, 15, 10, 30), 60);
  let allDay = newEvent(new Date(2026, 9, 15), 24 * 60);
  allDay.allDay = true;
  let declined = newEvent(new Date(2026, 9, 15, 10, 0), 30);
  invite(declined, InvitationResponse.Decline);
  expect(eventConflict(event, [event, before])).toBe("adjacent");
  expect(eventConflict(event, [before, overlapping])).toBe("conflict");
  expect(eventConflict(event, [allDay, declined])).toBe(null);
});

test("Info bar of a new meeting, of an invitation, and of a cancelled meeting", () => {
  let now = new Date(2026, 9, 1);
  let meeting = newEvent();
  organize(meeting, InvitationResponse.Unknown);
  expect(eventInfoMessages(meeting, [], now).map(message => message.text))
    .toEqual(["You haven't sent this meeting invitation yet"]);

  let invitation = newEvent();
  invite(invitation, InvitationResponse.NoResponseReceived);
  expect(eventInfoMessages(invitation, [], now)[0].text).toBe("Please respond");
  invitation.myParticipation = InvitationResponse.Accept;
  expect(eventInfoMessages(invitation, [], now)[0].text).toBe("You accepted this meeting");
  invitation.isCancelled = true;
  expect(eventInfoMessages(invitation, [], now)[0]).toEqual({ kind: "cancelled", text: "This meeting has been cancelled by the organizer" });
});

test("Info bar: in the past, and the series of an occurrence", () => {
  let event = newEvent();
  expect(eventInfoMessages(event, [], new Date(2026, 9, 16)).map(message => message.text))
    .toEqual(["This appointment occurs in the past"]);
  event.newRecurrenceRule(Frequency.Weekly);
  let occurrence = event.instances.get(1);
  let messages = eventInfoMessages(occurrence, [], new Date(2026, 9, 1));
  expect(messages[0].kind).toBe("recurrence");
  expect(messages[0].text).toContain("Every week, on Thursday");

  // The series end from the recurrence dialog, before it is saved
  let pattern = RecurrencePattern.fromEvent(occurrence);
  pattern.end = "count";
  pattern.count = 5;
  messages = eventInfoMessages(occurrence, [], new Date(2026, 9, 1), pattern);
  expect(messages[0].text).toContain("5 times");
});

test("When text", () => {
  let event = newEvent();
  expect(plain(eventWhenText(event, "en-US"))).toBe("Thursday, October 15, 2026, 10:00 – 10:30 AM");
  let allDay = newEvent(new Date(2026, 9, 15), 2 * 24 * 60);
  allDay.allDay = true;
  expect(plain(eventWhenText(allDay, "en-US"))).toBe("Thursday, October 15 – Friday, October 16, 2026 (all day)");
});

test("Tracking table sorts by name, attendance and response", () => {
  let event = newEvent();
  organize(event, InvitationResponse.Tentative, InvitationResponse.Accept, InvitationResponse.NoResponseReceived);
  let participants = event.participants.contents;
  let names = (column: Parameters<typeof sortForTracking>[1], ascending: boolean) =>
    sortForTracking(participants, column, ascending).map(participant => participant.name);
  expect(names(null, true)).toEqual(["Me", "Person 0", "Person 1", "Person 2"]);
  expect(names("name", false)).toEqual(["Person 2", "Person 1", "Person 0", "Me"]);
  expect(names("attendance", true)[0]).toBe("Me");
  expect(names("response", true)).toEqual(["Person 1", "Me", "Person 2", "Person 0"]);
});
