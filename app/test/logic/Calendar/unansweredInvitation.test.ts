// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../logic/app";
import { Calendar } from "../../../logic/Calendar/Calendar";
import { EWSEvent } from "../../../logic/Calendar/EWS/EWSEvent";
import { OWAEvent } from "../../../logic/Calendar/OWA/OWAEvent";
import { ActiveSyncEvent } from "../../../logic/Calendar/ActiveSync/ActiveSyncEvent";
import { InvitationResponse } from "../../../logic/Calendar/Invitation/InvitationStatus";
import { expect, test } from "vitest";

/* When an invitation arrives, Exchange puts the meeting into the invitee's
 * calendar right away, before the user answered it. Exchange marks such a
 * calendar item as "not responded" (XSO `ResponseType.NotResponded`),
 * which EWS and OWA call `NoResponseReceived` and ActiveSync sends as 5. */

const kOrganizer = { Mailbox: { EmailAddress: "chief@example.com", Name: "Chief" } };
const kAttendee = { Mailbox: { EmailAddress: "worker@example.com", Name: "Worker" }, ResponseType: "Unknown" };

function ewsEvent(myResponse: string): EWSEvent {
  let event = new EWSEvent(new Calendar() as any);
  event.fromXML({
    ItemId: { Id: "item" },
    Subject: "Planning",
    Start: "2026-07-14T10:00:00Z",
    End: "2026-07-14T11:00:00Z",
    Organizer: kOrganizer,
    RequiredAttendees: { Attendee: kAttendee },
    MyResponseType: myResponse,
  });
  return event;
}

function owaEvent(myResponse: string): OWAEvent {
  let event = new OWAEvent();
  event.fromJSON({
    ItemId: { Id: "AAMkAGItem=" },
    Subject: "Planning",
    Start: "2026-07-14T10:00:00Z",
    End: "2026-07-14T11:00:00Z",
    Organizer: kOrganizer,
    RequiredAttendees: [kAttendee],
    // OWA's JSON calls `calendar:MyResponseType` just `ResponseType`
    ResponseType: myResponse,
  });
  return event;
}

function activeSyncEvent(myResponse: string): ActiveSyncEvent {
  let calendar = new Calendar() as any;
  calendar.account = { protocolVersion: "16.1" };
  let event = new ActiveSyncEvent(calendar);
  event.fromWBXML({
    Subject: "Planning",
    OrganizerEmail: "chief@example.com",
    OrganizerName: "Chief",
    Attendees: { Attendee: [{ Email: "worker@example.com", Name: "Worker", AttendeeStatus: "0" }] },
    ResponseType: myResponse,
  });
  return event;
}

test("EWS: Meeting that Exchange added to the calendar, but the user did not answer yet", () => {
  let event = ewsEvent("NoResponseReceived");
  expect(event.myParticipation).toBe(InvitationResponse.NoResponseReceived);
  expect(event.isIncomingMeeting).toBe(true);
});

test("EWS: Answered meetings and own meetings are not unanswered", () => {
  for (let response of ["Accept", "Tentative", "Decline", "Organizer", "Unknown"]) {
    expect(ewsEvent(response).myParticipation, response).not.toBe(InvitationResponse.NoResponseReceived);
  }
});

test("OWA: Meeting that Exchange added to the calendar, but the user did not answer yet", () => {
  let event = owaEvent("NoResponseReceived");
  expect(event.myParticipation).toBe(InvitationResponse.NoResponseReceived);
});

test("OWA: Answered meetings and own meetings are not unanswered", () => {
  for (let response of ["Accept", "Tentative", "Decline", "Organizer", "Unknown"]) {
    expect(owaEvent(response).myParticipation, response).not.toBe(InvitationResponse.NoResponseReceived);
  }
});

test("ActiveSync: Meeting that Exchange added to the calendar, but the user did not answer yet", () => {
  // MS-ASCAL 2.2.2.38 ResponseType: 5 = Not responded
  let event = activeSyncEvent("5");
  expect(event.myParticipation).toBe(InvitationResponse.NoResponseReceived);
});

test("ActiveSync: Answered meetings and own meetings are not unanswered", () => {
  // 0 = None, 1 = Organizer, 2 = Tentative, 3 = Accepted, 4 = Declined
  for (let response of ["0", "1", "2", "3", "4"]) {
    expect(activeSyncEvent(response).myParticipation, response).not.toBe(InvitationResponse.NoResponseReceived);
  }
});

test("Cancelled unanswered meeting is both cancelled and unanswered", () => {
  let event = new OWAEvent();
  event.fromJSON({
    ItemId: { Id: "AAMkAGItem=" },
    Subject: "Canceled: Planning",
    Start: "2026-07-14T10:00:00Z",
    End: "2026-07-14T11:00:00Z",
    Organizer: kOrganizer,
    RequiredAttendees: [kAttendee],
    ResponseType: "NoResponseReceived",
    IsCancelled: true,
  });
  expect(event.isCancelled).toBe(true);
  expect(event.myParticipation).toBe(InvitationResponse.NoResponseReceived);
});
