// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { JMAPAccount } from "../../../../logic/Mail/JMAP/JMAPAccount";
import { CalDAVCalendar } from "../../../../logic/Calendar/CalDAV/CalDAVCalendar";
import { AuthMethod } from "../../../../logic/Abstract/Account";
import type { CalDAVEvent } from "../../../../logic/Calendar/CalDAV/CalDAVEvent";
import { Participant } from "../../../../logic/Calendar/Participant";
import { InvitationResponse } from "../../../../logic/Calendar/Invitation/InvitationStatus";
import { DummyCalendarStorage } from "../../../../logic/Calendar/SQL/DummyCalendarStorage";
import type { EMail } from "../../../../logic/Mail/EMail";
import { SpecialFolder } from "../../../../logic/Mail/Folder";
import { MailIdentity } from "../../../../logic/Mail/MailIdentity";
import { afterEach, beforeAll, expect, test } from "vitest";

/* Our app sends the invitations of CalDAV events itself (`CalDAVEvent.saveToServer()`),
 * so it must also send the cancellation or the decline when an event is deleted. */

const kMe = "calendar-alice@example.com";
const kAttendee = "calendar-bob@example.com";
const kCalendarURL = "https://dav.example.com/calendars/alice/";
const kStartTime = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

beforeAll(() => {
  appGlobal.remoteApp ??= {
    kyCreate: () => { throw new Error("The test should not talk to a server"); },
  } as any;
});

afterEach(() => {
  appGlobal.calendars.clear();
  appGlobal.emailAccounts.clear();
});

/** A mail account with my identity, and a CalDAV calendar, with the server calls and sent mails captured.
 * The mail account is only for sending; any protocol would do.
 * @param deleteStatus the HTTP status that the server answers to the DELETE */
function setup(deleteStatus = 204) {
  let account = new JMAPAccount();
  account.emailAddress = kMe;
  account.realname = "Alice";
  let identity = new MailIdentity(account);
  identity.emailAddress = kMe;
  identity.realname = account.realname;
  account.identities.add(identity);
  for (let specialFolder of [SpecialFolder.Inbox, SpecialFolder.Sent]) {
    let folder = account.newFolder();
    folder.specialFolder = specialFolder;
    account.rootFolders.add(folder);
  }
  appGlobal.emailAccounts.add(account);
  let sent: EMail[] = [];
  account.send = async (email: EMail) => {
    sent.push(email);
  };

  let calendar = new CalDAVCalendar();
  calendar.name = "Alice";
  calendar.calendarURL = kCalendarURL;
  calendar.authMethod = AuthMethod.Password;
  calendar.password = "test";
  calendar.storage = new DummyCalendarStorage();
  let deleted: string[] = [];
  // `login()` returns early when we already have a client
  calendar.client = {
    deleteCalendarObject: async ({ calendarObject }) => {
      deleted.push(calendarObject.url);
      return new Response(null, { status: deleteStatus });
    },
  } as any;
  appGlobal.calendars.add(calendar);
  return { calendar, deleted, sent };
}

/** A meeting with me and Bob, as read from the server */
function addMeeting(calendar: CalDAVCalendar, organizer: string): CalDAVEvent {
  let event = calendar.newEvent() as CalDAVEvent;
  event.calUID = "c3edf21c-a0f3-4ad2-b6e4-1edf565c59bf";
  event.url = kCalendarURL + event.calUID + ".ics";
  event.title = "Project meeting";
  event.startTime = new Date(kStartTime);
  event.endTime = new Date(kStartTime.getTime() + 60 * 60 * 1000);
  event.participants.add(new Participant(organizer, null, InvitationResponse.Organizer));
  let attendee = organizer == kMe ? kAttendee : kMe;
  event.participants.add(new Participant(attendee, null, organizer == kMe ? InvitationResponse.NoResponseReceived : InvitationResponse.Accept));
  event.myParticipation = organizer == kMe ? InvitationResponse.Organizer : InvitationResponse.Accept;
  calendar.events.add(event);
  return event;
}

test("Deleting a meeting that I organize cancels it for the attendees", async () => {
  let { calendar, deleted, sent } = setup();
  let event = addMeeting(calendar, kMe);
  expect(event.isOutgoingMeeting).toBe(true);

  await event.deleteIt();

  expect(deleted).toContain(event.url);
  let cancellations = sent.filter(email => email.iCalMethod == "CANCEL");
  let recipients = cancellations.flatMap(email => email.to.contents.map(person => person.emailAddress));
  expect(recipients).toContain(kAttendee);
  expect(recipients).not.toContain(kMe);
});

test("Deleting an invitation declines it", async () => {
  let { calendar, deleted, sent } = setup();
  let event = addMeeting(calendar, kAttendee);
  expect(event.isIncomingMeeting).toBe(true);

  await event.deleteIt();

  expect(deleted).toContain(event.url);
  let declines = sent.filter(email => email.iCalMethod == "REPLY" &&
    email.to.contents.some(person => person.emailAddress == kAttendee) &&
    email.event.participants.find(participant => participant.emailAddress == kMe)?.response == InvitationResponse.Decline);
  expect(declines.length).toBeGreaterThan(0);
});

test("A meeting that was already deleted on the server is still cancelled", async () => {
  let { calendar, sent } = setup(404);
  let event = addMeeting(calendar, kMe);

  await event.deleteIt();

  expect(sent.some(email => email.iCalMethod == "CANCEL")).toBe(true);
});

test("Nothing is sent when the server refuses to delete the meeting", async () => {
  let { calendar, sent } = setup(403);
  let event = addMeeting(calendar, kMe);

  await expect(event.deleteIt()).rejects.toThrow();
  expect(sent.length).toBe(0);
});

test("Deleting an event without participants sends nothing", async () => {
  let { calendar, deleted, sent } = setup();
  let event = addMeeting(calendar, kMe);
  event.participants.clear();
  event.myParticipation = InvitationResponse.Unknown;

  await event.deleteIt();

  expect(deleted).toContain(event.url);
  expect(sent.length).toBe(0);
});
