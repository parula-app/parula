// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { Calendar } from "../../../../logic/Calendar/Calendar";
import type { Event } from "../../../../logic/Calendar/Event";
import { ICalEMailProcessor } from "../../../../logic/Calendar/ICal/ICalEMailProcessor";
import { getICal } from "../../../../logic/Calendar/ICal/ICalGenerator";
import { InvitationMessage, InvitationResponse } from "../../../../logic/Calendar/Invitation/InvitationStatus";
import { DummyCalendarStorage } from "../../../../logic/Calendar/SQL/DummyCalendarStorage";
import { IMAPAccount } from "../../../../logic/Mail/IMAP/IMAPAccount";
import type { EMail } from "../../../../logic/Mail/EMail";
import { SpecialFolder } from "../../../../logic/Mail/Folder";
import { MailIdentity } from "../../../../logic/Mail/MailIdentity";
import { afterEach, beforeAll, expect, test } from "vitest";

/* The organizer changes a meeting that the user already accepted, and sends
 * the changed meeting as a new invitation, with the same UID, RFC 5546 3.2.2.
 * `SEQUENCE` and then `DTSTAMP` say which version is newer, RFC 5546 2.1.5. */

const kMe = "worker@example.com";
const kOrganizer = "chief@example.com";
const kCalUID = "changed-meeting-1234@example.com";
const k1Hour = 60 * 60 * 1000;
/** In the future, because we don't reply to past meetings */
const kStartTime = new Date(Math.ceil((Date.now() + 7 * 24 * k1Hour) / k1Hour) * k1Hour);

function toICalDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
}

interface Version {
  /** `DTSTAMP`, e.g. "20260901T100000Z" */
  stamp: string;
  sequence?: number;
  method?: "REQUEST" | "CANCEL";
  start?: Date;
  title?: string;
  description?: string;
  location?: string;
  conference?: string;
  organizer?: string;
  rrule?: string;
  /** Replaces the `DTSTART` value, e.g. with one that we cannot read */
  startValue?: string;
}

function invitationICal(version: Version): string {
  let start = version.start ?? kStartTime;
  let organizer = version.organizer ?? kOrganizer;
  let lines = [
    "BEGIN:VCALENDAR",
    "PRODID:-//Example/ExampleCalendarClient//EN",
    "METHOD:" + (version.method ?? "REQUEST"),
    "VERSION:2.0",
    "BEGIN:VEVENT",
    "UID:" + kCalUID,
    "DTSTAMP:" + version.stamp,
    "SEQUENCE:" + (version.sequence ?? 0),
    "DTSTART:" + (version.startValue ?? toICalDate(start)),
    "DTEND:" + toICalDate(new Date(start.getTime() + k1Hour)),
    "SUMMARY:" + (version.title ?? "Planning"),
    "DESCRIPTION:" + (version.description ?? "What we do next year"),
    "LOCATION:" + (version.location ?? "Room 1"),
    "ORGANIZER;CN=Chief:mailto:" + organizer,
    "ATTENDEE;ROLE=CHAIR;PARTSTAT=ACCEPTED;CN=Chief:mailto:" + organizer,
    "ATTENDEE;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN=Worker:mailto:" + kMe,
  ];
  if (version.conference) {
    lines.push("CONFERENCE;VALUE=URI:" + version.conference);
  }
  if (version.rrule) {
    lines.push("RRULE:" + version.rrule);
  }
  lines.push("END:VEVENT", "END:VCALENDAR", "");
  return lines.join("\r\n");
}

beforeAll(() => {
  let noServer = () => { throw new Error("The test should not talk to a server"); };
  appGlobal.remoteApp ??= {
    kyCreate: noServer,
    createIMAPFlowConnection: noServer,
  };
});

afterEach(() => {
  appGlobal.calendars.clear();
  appGlobal.emailAccounts.clear();
});

/** An IMAP account, which has no calendar of its own, and the local calendar */
function setup() {
  let account = new IMAPAccount();
  account.emailAddress = kMe;
  account.realname = "Worker";
  account.accountID = "imapAccount";
  let identity = new MailIdentity(account);
  identity.emailAddress = kMe;
  identity.realname = account.realname;
  account.identities.add(identity);
  for (let specialFolder of [SpecialFolder.Inbox, SpecialFolder.Sent]) {
    let folder = account.newFolder();
    folder.specialFolder = specialFolder;
    account.rootFolders.add(folder);
  }
  let sent: EMail[] = [];
  account.send = async (email: EMail) => {
    sent.push(email);
  };
  appGlobal.emailAccounts.add(account);

  let calendar = new Calendar();
  calendar.name = "Local";
  calendar.storage = new DummyCalendarStorage();
  appGlobal.calendars.add(calendar);
  return { account, calendar, sent };
}

type Setup = ReturnType<typeof setup>;

/** The invitation email arrives in the inbox, and we parse it, like `EMail.parseMIME()` does */
async function receive({ account }: Setup, version: Version): Promise<EMail> {
  let email = account.getSpecialFolder(SpecialFolder.Inbox).newEMail();
  let attachment = email.newAttachment();
  attachment.fromFile(new File([invitationICal(version)], "invite.ics", { type: "text/calendar" }));
  email.attachments.add(attachment);
  await new ICalEMailProcessor().process(email);
  return email;
}

/** The user accepted the first invitation */
async function acceptedMeeting(version: Partial<Version> = {}) {
  let setupResult = setup();
  let { calendar, sent } = setupResult;
  let email = await receive(setupResult, { stamp: "20260901T100000Z", ...version });
  expect(email.invitationMessage).toEqual(InvitationMessage.Invitation);
  await calendar.getIncomingInvitationForEMail(email).respondToInvitationFromMail(InvitationResponse.Accept);
  expect(calendar.events.length).toEqual(1);
  let event = calendar.events.first;
  expect(event.myParticipation).toEqual(InvitationResponse.Accept);
  expect(sent.length).toEqual(1);
  return { ...setupResult, event };
}

function myParticipant(event: Event) {
  return event.participants.find(participant => participant.emailAddress == kMe);
}

test("A changed description updates the accepted meeting and keeps my response", async () => {
  let setupResult = await acceptedMeeting();
  let { calendar, event, sent } = setupResult;

  await receive(setupResult, { stamp: "20260902T100000Z", title: "Planning 2027", description: "Bring the numbers" });

  expect(calendar.events.length).toEqual(1);
  expect(calendar.events.first).toBe(event);
  expect(event.title).toEqual("Planning 2027");
  expect(event.descriptionText).toEqual("Bring the numbers");
  expect(event.startTime).toEqual(kStartTime);
  expect(event.myParticipation).toEqual(InvitationResponse.Accept);
  expect(myParticipant(event).response).toEqual(InvitationResponse.Accept);
  expect(event.isMoved).toBe(false);
  // Nothing to tell the organizer
  expect(sent.length).toEqual(1);
});

test("A new time makes the accepted meeting unanswered and moved", async () => {
  let setupResult = await acceptedMeeting();
  let { calendar, event, sent } = setupResult;
  let newStart = new Date(kStartTime.getTime() + 2 * k1Hour);

  let email = await receive(setupResult, { stamp: "20260902T100000Z", sequence: 1, start: newStart });

  // The meeting moved, instead of being in the calendar twice
  expect(calendar.events.length).toEqual(1);
  expect(event.startTime).toEqual(newStart);
  expect(event.endTime).toEqual(new Date(newStart.getTime() + k1Hour));
  expect(event.sequence).toEqual(1);
  expect(event.isMoved).toBe(true);
  expect(event.myParticipation).toEqual(InvitationResponse.NoResponseReceived);
  expect(myParticipant(event).response).not.toEqual(InvitationResponse.Accept);
  expect(event.isIncomingMeeting).toBe(true);
  // The invitation email offers to respond again
  expect(calendar.getIncomingInvitationForEMail(email).myParticipation).toEqual(InvitationResponse.NoResponseReceived);
  expect(sent.length).toEqual(1);
});

test("A new place makes the accepted meeting unanswered and moved", async () => {
  let setupResult = await acceptedMeeting();
  let { event } = setupResult;

  await receive(setupResult, { stamp: "20260902T100000Z", sequence: 1, location: "Room 2" });

  expect(event.location).toEqual("Room 2");
  expect(event.startTime).toEqual(kStartTime);
  expect(event.isMoved).toBe(true);
  expect(event.myParticipation).toEqual(InvitationResponse.NoResponseReceived);
});

test("A new link to the online meeting keeps my response", async () => {
  let setupResult = await acceptedMeeting({ conference: "https://meet.example.com/old" });
  let { event } = setupResult;

  await receive(setupResult, { stamp: "20260902T100000Z", conference: "https://meet.example.com/new" });

  expect(event.onlineMeetingURL).toEqual("https://meet.example.com/new");
  expect(event.isMoved).toBe(false);
  expect(event.myParticipation).toEqual(InvitationResponse.Accept);
});

test("Responding to the moved meeting ends the moved state, and the reply names the new version", async () => {
  let setupResult = await acceptedMeeting();
  let { calendar, event, sent } = setupResult;
  let newStart = new Date(kStartTime.getTime() + 2 * k1Hour);
  let email = await receive(setupResult, { stamp: "20260902T100000Z", sequence: 1, start: newStart });

  await calendar.getIncomingInvitationForEMail(email).respondToInvitationFromMail(InvitationResponse.Tentative);

  expect(calendar.events.length).toEqual(1);
  expect(event.isMoved).toBe(false);
  expect(event.myParticipation).toEqual(InvitationResponse.Tentative);
  expect(myParticipant(event).response).toEqual(InvitationResponse.Tentative);
  expect(sent.length).toEqual(2);
  expect(sent[1].iCalMethod).toEqual("REPLY");
  expect(sent[1].event.startTime).toEqual(newStart);
  // RFC 5546 3.2.3: The reply must say which version it answers
  expect(await getICal(sent[1].event, "REPLY")).toMatch(/\r\nSEQUENCE:1\r\n/);
});

test("Responding to the moved meeting in the calendar ends the moved state", async () => {
  let setupResult = await acceptedMeeting();
  let { event, sent } = setupResult;
  await receive(setupResult, { stamp: "20260902T100000Z", sequence: 1, location: "Room 2" });

  await event.respondToInvitation(InvitationResponse.Accept);

  expect(event.isMoved).toBe(false);
  expect(event.myParticipation).toEqual(InvitationResponse.Accept);
  expect(sent.length).toEqual(2);
});

test("The same change arriving again does not reset my new response", async () => {
  let setupResult = await acceptedMeeting();
  let { calendar, event } = setupResult;
  let change: Version = { stamp: "20260902T100000Z", sequence: 1, location: "Room 2" };
  let email = await receive(setupResult, change);
  await calendar.getIncomingInvitationForEMail(email).respondToInvitationFromMail(InvitationResponse.Accept);

  await receive(setupResult, change);

  expect(event.isMoved).toBe(false);
  expect(event.myParticipation).toEqual(InvitationResponse.Accept);
});

test("An older version of the meeting does not overwrite a newer one", async () => {
  let setupResult = await acceptedMeeting();
  let { event } = setupResult;
  await receive(setupResult, { stamp: "20260903T100000Z", sequence: 2, location: "Room 3" });

  // A lower `SEQUENCE` is older, even with a later `DTSTAMP`
  await receive(setupResult, { stamp: "20260904T100000Z", sequence: 1, location: "Room 2" });
  expect(event.location).toEqual("Room 3");
  // With the same `SEQUENCE`, the later `DTSTAMP` wins
  await receive(setupResult, { stamp: "20260902T100000Z", sequence: 2, location: "Room 3", title: "Old title" });
  expect(event.title).toEqual("Planning");
  await receive(setupResult, { stamp: "20260905T100000Z", sequence: 2, location: "Room 3", title: "New title" });
  expect(event.title).toEqual("New title");
});

test("Somebody else than the organizer cannot change the meeting", async () => {
  let setupResult = await acceptedMeeting();
  let { event } = setupResult;

  await receive(setupResult, { stamp: "20260902T100000Z", sequence: 5, location: "Somewhere else", organizer: "stranger@example.net" });

  expect(event.location).toEqual("Room 1");
  expect(event.isMoved).toBe(false);
  expect(event.myParticipation).toEqual(InvitationResponse.Accept);
});

test("The reminder moves together with the meeting", async () => {
  let setupResult = await acceptedMeeting();
  let { event } = setupResult;
  event.alarm = new Date(kStartTime.getTime() - 15 * 60 * 1000);
  let newStart = new Date(kStartTime.getTime() + 24 * k1Hour);

  await receive(setupResult, { stamp: "20260902T100000Z", sequence: 1, start: newStart });

  expect(event.alarm).toEqual(new Date(newStart.getTime() - 15 * 60 * 1000));
});

test("A change of a meeting that I did not answer yet does not add it to the calendar", async () => {
  let setupResult = setup();
  let { calendar } = setupResult;
  await receive(setupResult, { stamp: "20260901T100000Z" });

  await receive(setupResult, { stamp: "20260902T100000Z", sequence: 1, location: "Room 2" });

  expect(calendar.events.length).toEqual(0);
});

test("A moved recurring meeting moves all its occurrences", async () => {
  let setupResult = await acceptedMeeting({ rrule: "FREQ=WEEKLY;COUNT=4" });
  let { event } = setupResult;
  expect(event.instances.length).toEqual(4);
  let newStart = new Date(kStartTime.getTime() + 2 * k1Hour);

  await receive(setupResult, { stamp: "20260902T100000Z", sequence: 1, start: newStart, rrule: "FREQ=WEEKLY;COUNT=4" });

  expect(event.recurrenceRule.seriesStartTime).toEqual(newStart);
  expect(event.instances.length).toEqual(4);
  expect(event.instances.first.startTime).toEqual(newStart);
  for (let occurrence of event.instances) {
    expect(occurrence.isMoved).toBe(true);
    expect(occurrence.myParticipation).toEqual(InvitationResponse.NoResponseReceived);
  }
});

test("A cancellation of an older version is ignored", async () => {
  let setupResult = await acceptedMeeting();
  let { event } = setupResult;
  await receive(setupResult, { stamp: "20260903T100000Z", sequence: 2, location: "Room 3" });

  await receive(setupResult, { stamp: "20260904T100000Z", sequence: 1, method: "CANCEL" });
  expect(event.isCancelled).toBe(false);

  await receive(setupResult, { stamp: "20260904T100000Z", sequence: 3, method: "CANCEL" });
  expect(event.isCancelled).toBe(true);
});

test("The version and the moved state are kept in the database", async () => {
  let setupResult = await acceptedMeeting();
  let { calendar, event } = setupResult;
  await receive(setupResult, { stamp: "20260902T100000Z", sequence: 3, location: "Room 2" });

  let loaded = calendar.newEvent();
  loaded.fromExtraJSON(JSON.parse(JSON.stringify(event.toExtraJSON())));

  expect(loaded.sequence).toEqual(3);
  expect(loaded.isMoved).toBe(true);
});

test("An update without a readable start time leaves the meeting in the calendar as it is", async () => {
  let setupResult = await acceptedMeeting({ rrule: "FREQ=WEEKLY;COUNT=5" });
  let { event } = setupResult;

  await receive(setupResult, { stamp: "20260902T100000Z", sequence: 1, location: "Room 2", rrule: "FREQ=WEEKLY;COUNT=5", startValue: "20261028T1730" });

  expect(event.startTime).toEqual(kStartTime);
  expect(event.recurrenceRule).toBeTruthy();
  expect(event.location).toEqual("Room 1");
  expect(event.myParticipation).toEqual(InvitationResponse.Accept);
});
