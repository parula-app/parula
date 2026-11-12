// @vitest-environment happy-dom
import "../../../logic/app"; // first, to resolve the import cycle around Abstract/Account.ts
import { Calendar } from "../../../logic/Calendar/Calendar";
import { Participant } from "../../../logic/Calendar/Participant";
import { InvitationResponse } from "../../../logic/Calendar/Invitation/InvitationStatus";
import { FreeBusy, SlotAvailability } from "../../../logic/Calendar/FreeBusy";
import { FreeBusyEvent, FreeBusyStatus } from "../../../logic/Calendar/FreeBusyEvent";
import type { Event } from "../../../logic/Calendar/Event";
import { ArrayColl } from "svelte-collections";
import { expect, test } from "vitest";

function at(hours: number, minutes = 0): Date {
  return new Date(2026, 9, 15, hours, minutes);
}

function appointment(from: Date, to: Date, status = FreeBusyStatus.Busy, title?: string, location?: string): FreeBusyEvent {
  let event = new FreeBusyEvent(from, to, status);
  event.title = title;
  event.location = location;
  return event;
}

const anna = new Participant("anna@example.com", "Anna", InvitationResponse.Organizer);
const bert = new Participant("bert@example.com", "Bert", InvitationResponse.NoResponseReceived);
const carla = new Participant("carla@example.com", "Carla", InvitationResponse.Accept);

class FreeBusyCalendar extends Calendar {
  requested: { participants: Participant[], from: Date, to: Date };
  async arePersonsFree(participants: Participant[], from: Date, to: Date) {
    this.requested = { participants, from, to };
    return [
      { participant: participants[0], availability: [
        appointment(at(9), at(10)),
        appointment(at(10), at(12), FreeBusyStatus.Free),
      ] },
      { participant: participants[1], availability: [
        appointment(at(9, 30), at(11)),
        appointment(at(14), at(15)),
      ] },
      { participant: participants[2], availability: undefined },
    ];
  }
}

test("Loads the availability with the logic call", async () => {
  let calendar = new FreeBusyCalendar();
  let freeBusy = await FreeBusy.load(calendar, [anna, bert, carla], at(0), at(24));
  expect(calendar.requested.participants).toEqual([anna, bert, carla]);
  expect(calendar.requested.from).toEqual(at(0));
  expect(freeBusy.hasInformation).toBe(true);
  expect(freeBusy.rowFor(anna).busy).toEqual([{ startTime: at(9), endTime: at(10) }]);
  expect(freeBusy.rowFor(carla).busy).toBe(null);
});

test("All attendees: union of the busy times", async () => {
  let freeBusy = await FreeBusy.load(new FreeBusyCalendar(), [anna, bert, carla], at(0), at(24));
  expect(freeBusy.allAttendeesBusy).toEqual([
    { startTime: at(9), endTime: at(11) },
    { startTime: at(14), endTime: at(15) },
  ]);
});

test("Status of each attendee at the meeting time", async () => {
  let freeBusy = await FreeBusy.load(new FreeBusyCalendar(), [anna, bert, carla], at(0), at(24));
  expect(freeBusy.status(anna, at(10), at(11))).toBe("free");
  expect(freeBusy.status(anna, at(9, 30), at(10, 30))).toBe("busy");
  expect(freeBusy.status(bert, at(10), at(11))).toBe("busy");
  expect(freeBusy.status(bert, at(11), at(14))).toBe("free");
  expect(freeBusy.status(carla, at(10), at(11))).toBe("unknown");
});

test("Calendars without free/busy support give no information", async () => {
  let calendar = new Calendar();
  let freeBusy = await FreeBusy.load(calendar, [anna, bert], at(0), at(24));
  expect(freeBusy.hasInformation).toBe(false);
  expect(freeBusy.rows.map(row => row.busy)).toEqual([null, null]);
  expect(freeBusy.status(anna, at(10), at(11))).toBe("unknown");
  expect(freeBusy.isSupported).toBe(false);
});

test("Whether the calendar provides free/busy at all, asked once per calendar", async () => {
  expect(await FreeBusy.isSupported(new Calendar(), [anna])).toBe(false);
  let calendar = new FreeBusyCalendar();
  expect(await FreeBusy.isSupported(calendar, [anna, bert, carla])).toBe(true);
  calendar.requested = null;
  expect(await FreeBusy.isSupported(calendar, [anna, bert, carla])).toBe(true);
  expect(calendar.requested).toBe(null);
});

test("Without participants, nothing is known, and the calendar is not marked as without free/busy", async () => {
  let calendar = new Calendar();
  let freeBusy = await FreeBusy.load(calendar, [], at(0), at(24));
  expect(freeBusy.hasInformation).toBe(false);
  expect(freeBusy.isSupported).toBe(true);
  expect(await FreeBusy.isSupported(calendar, [])).toBe(true);
  expect(await FreeBusy.isSupported(calendar, [anna])).toBe(false);
});

test("Results are matched by email address, if the server returns other objects", () => {
  let bertCopy = new Participant("bert@example.com", "Bert B.", InvitationResponse.Unknown);
  let freeBusy = FreeBusy.fromAvailability([bert], [
    { participant: bertCopy, availability: [appointment(at(8), at(9))] },
  ]);
  expect(freeBusy.rowFor(bert).busy).toEqual([{ startTime: at(8), endTime: at(9) }]);
});

test("Merge overlapping and touching intervals", () => {
  expect(FreeBusy.merge([
    { startTime: at(13), endTime: at(14) },
    { startTime: at(9), endTime: at(10) },
    { startTime: at(10), endTime: at(11) },
    { startTime: at(10, 30), endTime: at(10, 45) },
    { startTime: at(12), endTime: at(12) },
  ])).toEqual([
    { startTime: at(9), endTime: at(11) },
    { startTime: at(13), endTime: at(14) },
  ]);
});

test("Keeps each appointment with its status and details, for display", () => {
  let freeBusy = FreeBusy.fromAvailability([anna], [
    { participant: anna, availability: [
      appointment(at(11), at(12), FreeBusyStatus.Tentative, "Lunch", "Canteen"),
      appointment(at(9), at(10)),
      appointment(at(9, 30), at(10, 30), FreeBusyStatus.OutOfOffice),
      appointment(at(13), at(14), FreeBusyStatus.Free),
    ] },
  ]);
  let row = freeBusy.rowFor(anna);
  expect(row.appointments.map(appointment => [appointment.startTime, appointment.busyStatus, appointment.title, appointment.location])).toEqual([
    [at(9), FreeBusyStatus.Busy, undefined, undefined],
    [at(9, 30), FreeBusyStatus.OutOfOffice, undefined, undefined],
    [at(11), FreeBusyStatus.Tentative, "Lunch", "Canteen"],
  ]);
  expect(row.busy).toEqual([
    { startTime: at(9), endTime: at(10, 30) },
    { startTime: at(11), endTime: at(12) },
  ]);
});

function slotAt(slots: ReturnType<FreeBusy["slots"]>, hours: number) {
  return slots.find(slot => slot.startTime.getTime() == at(hours).getTime());
}

test("Time slots: Free when everybody whose availability we know is free, busy when many are busy", async () => {
  let freeBusy = await FreeBusy.load(new FreeBusyCalendar(), [anna, bert, carla], at(0), at(24));
  let slots = freeBusy.slots([at(0)], 8, 16, 60);
  expect(slots.contents.map(slot => slot.startTime)).toEqual([8, 9, 10, 11, 12, 13, 14, 15].map(hours => at(hours)));
  expect(slots.contents.every(slot => slot.endTime.getTime() - slot.startTime.getTime() == 60 * 60 * 1000)).toBe(true);

  let nine = slotAt(slots, 9);
  expect(nine.busy.contents).toEqual([anna, bert]);
  expect(nine.unknown.contents).toEqual([carla]);
  expect(nine.availability).toBe(SlotAvailability.Busy);

  let noon = slotAt(slots, 12);
  expect(noon.free.contents).toEqual([anna, bert]);
  expect(noon.unknown.contents).toEqual([carla]);
  expect(noon.availability).toBe(SlotAvailability.Free);

  let two = slotAt(slots, 14);
  expect(two.busy.contents).toEqual([bert]);
  expect(two.free.contents).toEqual([anna]);
  expect(two.availability).toBe(SlotAvailability.Busy);

  let dora = new Participant("dora@example.com", "Dora", InvitationResponse.Accept);
  let withDora = FreeBusy.fromAvailability([anna, bert, dora], [
    { participant: anna, availability: [] },
    { participant: bert, availability: [appointment(at(14), at(15))] },
    { participant: dora, availability: [] },
  ]);
  expect(slotAt(withDora.slots([at(0)], 8, 16, 60), 14).availability).toBe(SlotAvailability.Partly);
});

test("Time slots: Each of the days, and none when nobody's availability is known", async () => {
  let freeBusy = await FreeBusy.load(new FreeBusyCalendar(), [anna, bert], at(0), at(24));
  let nextDay = new Date(2026, 9, 16);
  let slots = freeBusy.slots([at(0), nextDay], 8, 18, 30);
  expect(slots.length).toBe(2 * 20);
  expect(slots.last.endTime).toEqual(new Date(2026, 9, 16, 18));

  let unknown = await FreeBusy.load(new Calendar(), [anna, bert], at(0), at(24));
  expect(unknown.slots([at(0)], 8, 18, 60).isEmpty).toBe(true);
});

function myEvent(calendar: Calendar, from: Date, to: Date, title: string): Event {
  let event = calendar.newEvent();
  event.title = title;
  event.startTime = from;
  event.endTime = to;
  return event;
}

function myMeeting(calendar: Calendar): Event {
  let meeting = myEvent(calendar, at(9), at(10), "Planning");
  meeting.myParticipation = InvitationResponse.Organizer;
  meeting.participants.addAll([anna, bert, carla]);
  return meeting;
}

test("Own availability: our appointments from our calendars, instead of the server's", async () => {
  let calendar = new FreeBusyCalendar();
  let meeting = myMeeting(calendar);
  let invited = myEvent(calendar, at(13), at(14), "Invited");
  invited.myParticipation = InvitationResponse.NoResponseReceived;
  let maybe = myEvent(calendar, at(15), at(16), "Maybe");
  maybe.myParticipation = InvitationResponse.Tentative;
  let declined = myEvent(calendar, at(16), at(17), "Declined");
  declined.myParticipation = InvitationResponse.Decline;
  let cancelled = myEvent(calendar, at(17), at(18), "Cancelled");
  cancelled.isCancelled = true;
  let holiday = myEvent(calendar, at(0), at(24), "Holiday");
  holiday.allDay = true;
  let tomorrow = myEvent(calendar, new Date(2026, 9, 16, 12), new Date(2026, 9, 16, 13), "Tomorrow");
  let myEvents = new ArrayColl([meeting, myEvent(calendar, at(12), at(13), "Lunch"), invited, maybe, declined, cancelled, holiday, tomorrow]);

  let fromServer = await FreeBusy.load(calendar, [anna, bert, carla], at(0), at(24));
  let freeBusy = fromServer.withMyEvents(meeting, myEvents, at(0), at(24));
  // Not the meeting itself, which the server reported as busy
  expect(freeBusy.rowFor(anna).busy).toEqual([
    { startTime: at(12), endTime: at(14) },
    { startTime: at(15), endTime: at(16) },
  ]);
  expect(freeBusy.rowFor(anna).appointments.map(appointment => [appointment.title, appointment.busyStatus])).toEqual([
    ["Lunch", FreeBusyStatus.Busy],
    ["Invited", FreeBusyStatus.Tentative],
    ["Maybe", FreeBusyStatus.Tentative],
  ]);
  expect(freeBusy.rowFor(bert)).toBe(fromServer.rowFor(bert));
  expect(freeBusy.rowFor(carla).busy).toBe(null);
});

test("Own availability: Only for a meeting that we organize", async () => {
  let calendar = new FreeBusyCalendar();
  let meeting = myMeeting(calendar);
  meeting.myParticipation = InvitationResponse.Accept;
  let fromServer = await FreeBusy.load(calendar, [anna, bert, carla], at(0), at(24));
  let myEvents = new ArrayColl([myEvent(calendar, at(12), at(13), "Lunch")]);
  expect(fromServer.withMyEvents(meeting, myEvents, at(0), at(24))).toBe(fromServer);
});
