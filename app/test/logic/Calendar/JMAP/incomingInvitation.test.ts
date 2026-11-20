// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { JMAPAccount } from "../../../../logic/Mail/JMAP/JMAPAccount";
import { JMAPCalendar } from "../../../../logic/Calendar/JMAP/JMAPCalendar";
import { IMAPAccount } from "../../../../logic/Mail/IMAP/IMAPAccount";
import type { JMAPEvent } from "../../../../logic/Calendar/JMAP/JMAPEvent";
import type { TJMAPCalendarEvent } from "../../../../logic/Calendar/JMAP/TJSCalendar";
import { ICalEMailProcessor } from "../../../../logic/Calendar/ICal/ICalEMailProcessor";
import { IncomingInvitation } from "../../../../logic/Calendar/Invitation/IncomingInvitation";
import { Participant } from "../../../../logic/Calendar/Participant";
import { InvitationMessage, InvitationResponse } from "../../../../logic/Calendar/Invitation/InvitationStatus";
import { DummyCalendarStorage } from "../../../../logic/Calendar/SQL/DummyCalendarStorage";
import type { EMail } from "../../../../logic/Mail/EMail";
import { SpecialFolder } from "../../../../logic/Mail/Folder";
import type { MailAccount } from "../../../../logic/Mail/MailAccount";
import { MailIdentity } from "../../../../logic/Mail/MailIdentity";
import { afterEach, beforeAll, expect, test } from "vitest";

const kMe = "user2@example.com";
const kOrganizer = "user1@example.com";
/** My address at the IMAP account, which has no calendar of its own */
const kMyIMAPAddress = "user2@example.org";
const kCalUID = "calsvr.example.com-8739701987387998";

function toICalDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
}

/** RFC 6047 example invitation, but in the future, because we don't reply to past meetings */
const kStartTime = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
function invitationICal(attendee: string): string {
  return `BEGIN:VCALENDAR
PRODID:-//Example/ExampleCalendarClient//EN
METHOD:REQUEST
VERSION:2.0
BEGIN:VEVENT
ORGANIZER:mailto:${kOrganizer}
ATTENDEE;ROLE=CHAIR;PARTSTAT=ACCEPTED:mailto:${kOrganizer}
ATTENDEE;RSVP=YES;CUTYPE=INDIVIDUAL:mailto:${attendee}
DTSTAMP:20080507T170000Z
DTSTART:${toICalDate(kStartTime)}
DTEND:${toICalDate(new Date(kStartTime.getTime() + 30 * 60 * 1000))}
SUMMARY:Phone call to discuss your last visit
UID:${kCalUID}
SEQUENCE:0
STATUS:TENTATIVE
END:VEVENT
END:VCALENDAR
`;
}


afterEach(() => {
  appGlobal.calendars.clear();
  appGlobal.emailAccounts.clear();
});

beforeAll(() => {
  let noServer = () => { throw new Error("The test should not talk to a server"); };
  appGlobal.remoteApp ??= {
    kyCreate: noServer,
    createIMAPFlowConnection: noServer,
  };
});

/** A JMAP account with a linked JMAP calendar, with the server calls captured */
function setup() {
  let account = new JMAPAccount();
  account.emailAddress = kMe;
  account.realname = "User 2";
  account.accountID = "jmapAccount";
  let identity = new MailIdentity(account);
  identity.emailAddress = kMe;
  identity.realname = account.realname;
  account.identities.add(identity);
  for (let specialFolder of [SpecialFolder.Inbox, SpecialFolder.Sent]) {
    let folder = account.newFolder();
    folder.specialFolder = specialFolder;
    account.rootFolders.add(folder);
  }
  let calls: { method: string, args: any }[] = [];
  account.makeSingleCall = async (method: string, args: any) => {
    calls.push({ method, args });
    return { created: { [Object.keys(args.create ?? {})[0]]: { id: "serverEventID" } } };
  };
  let sent: EMail[] = [];
  account.send = async (email: EMail) => {
    sent.push(email);
  };

  let calendar = new JMAPCalendar();
  calendar.initFromMainAccount(account);
  calendar.jmapID = "calendarID";
  calendar.storage = new DummyCalendarStorage();

  return { account, calendar, calls, sent };
}

/** An IMAP account without any calendar of its own, with the sent mails captured */
function setupIMAP() {
  let account = new IMAPAccount();
  account.emailAddress = kMyIMAPAddress;
  account.realname = "User 2";
  account.accountID = "imapAccount";
  let identity = new MailIdentity(account);
  identity.emailAddress = kMyIMAPAddress;
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
  return { account, sent };
}

/** The invitation email, as it arrives in the inbox of `account` */
async function newInvitationEMail(account: MailAccount, attendee = kMe, ics = invitationICal(attendee)): Promise<EMail> {
  let email = account.getSpecialFolder(SpecialFolder.Inbox).newEMail();
  let attachment = email.newAttachment();
  attachment.fromFile(new File([ics], "invite.ics", { type: "text/calendar" }));
  email.attachments.add(attachment);
  await new ICalEMailProcessor().process(email);
  expect(email.invitationMessage).toEqual(InvitationMessage.Invitation);
  return email;
}

test("Accepting an invitation adds the event to the JMAP calendar", async () => {
  let { account, calendar, calls, sent } = setup();
  let email = await newInvitationEMail(account);

  // As `<InvitationButtons>` does it
  let invitation = calendar.getIncomingInvitationForEMail(email);
  await invitation.respondToInvitationFromMail(InvitationResponse.Accept);

  let event = calendar.events.first as JMAPEvent;
  expect(calendar.events.length).toEqual(1);
  expect(event.title).toEqual(email.event.title);
  expect(event.calUID).toEqual(email.event.calUID);
  expect(event.startTime).toEqual(email.event.startTime);
  expect(event.myParticipation).toEqual(InvitationResponse.Accept);
  expect(event.jmapID).toEqual("serverEventID");

  expect(calls.length).toEqual(1);
  expect(calls[0].method).toEqual("CalendarEvent/set");
  let created = Object.values(calls[0].args.create)[0] as TJMAPCalendarEvent;
  expect(created.uid).toEqual(email.event.calUID);
  expect(created.calendarIds).toEqual({ calendarID: true });
  let participants = Object.values(created.participants);
  expect(participants.find(participant => participant.calendarAddress == "mailto:" + kMe).participationStatus).toEqual("accepted");
  expect(participants.find(participant => participant.calendarAddress == "mailto:" + kOrganizer).roles.owner).toEqual(true);
  expect(created.organizerCalendarAddress).toEqual("mailto:" + kOrganizer);

  expect(sent.length).toEqual(1);
  expect(sent[0].iCalMethod).toEqual("REPLY");
  expect(sent[0].to.first.emailAddress).toEqual(kOrganizer);
  // Only myself in the reply: RFC 5546 3.2.3
  expect(sent[0].event.participants.length).toEqual(1);
  expect(sent[0].event.participants.first.emailAddress).toEqual(kMe);
  expect(sent[0].event.participants.first.response).toEqual(InvitationResponse.Accept);
});

test("A changed time of an accepted invitation reaches the JMAP server, with the organizer's new sequence", async () => {
  let { account, calendar, calls, sent } = setup();
  appGlobal.calendars.add(calendar);
  appGlobal.emailAccounts.add(account);
  let email = await newInvitationEMail(account);
  await calendar.getIncomingInvitationForEMail(email).respondToInvitationFromMail(InvitationResponse.Accept);
  let event = calendar.events.first as JMAPEvent;
  let newStart = new Date(email.event.startTime.getTime() + 60 * 60 * 1000);
  let changedICal = invitationICal(kMe)
    .replace("DTSTAMP:20080507T170000Z", "DTSTAMP:20080508T170000Z")
    .replace("SEQUENCE:0", "SEQUENCE:1")
    .replace(/DTSTART:.*/, "DTSTART:" + toICalDate(newStart))
    .replace(/DTEND:.*/, "DTEND:" + toICalDate(new Date(newStart.getTime() + 30 * 60 * 1000)));

  await newInvitationEMail(account, kMe, changedICal);

  expect(calendar.events.length).toEqual(1);
  expect(event.startTime).toEqual(newStart);
  expect(event.isMoved).toBe(true);
  expect(event.myParticipation).toEqual(InvitationResponse.NoResponseReceived);
  expect(calls.length).toEqual(2);
  let updated = calls[1].args.update.serverEventID as TJMAPCalendarEvent;
  expect(updated.sequence).toEqual(1);
  expect(updated.start).toEqual(newStart.toISOString().replace(/\.\d+Z$/, ""));
  let participants = Object.values(updated.participants);
  expect(participants.find(participant => participant.calendarAddress == "mailto:" + kMe).participationStatus).toEqual("needs-action");
  // Only the reply to the first invitation
  expect(sent.length).toEqual(1);
});

test("Declining an invitation tells the server and the organizer", async () => {
  let { account, calendar, calls, sent } = setup();
  let email = await newInvitationEMail(account);

  let invitation = calendar.getIncomingInvitationForEMail(email);
  await invitation.respondToInvitationFromMail(InvitationResponse.Decline);

  let created = Object.values(calls[0].args.create)[0] as TJMAPCalendarEvent;
  let participants = Object.values(created.participants);
  expect(participants.find(participant => participant.calendarAddress == "mailto:" + kMe).participationStatus).toEqual("declined");
  expect(sent[0].event.participants.first.response).toEqual(InvitationResponse.Decline);
});

test("Accepting an invitation without a reply adds the event, but tells the organizer nothing", async () => {
  let { account, calendar, calls, sent } = setup();
  let email = await newInvitationEMail(account);

  let invitation = calendar.getIncomingInvitationForEMail(email);
  await invitation.respondToInvitationFromMail(InvitationResponse.Accept, false);

  expect(calendar.events.length).toEqual(1);
  expect(calendar.events.first.myParticipation).toEqual(InvitationResponse.Accept);
  expect(calls.length).toEqual(1);
  expect(calls[0].method).toEqual("CalendarEvent/set");
  let created = Object.values(calls[0].args.create)[0] as TJMAPCalendarEvent;
  let participants = Object.values(created.participants);
  expect(participants.find(participant => participant.calendarAddress == "mailto:" + kMe).participationStatus).toEqual("accepted");
  // Neither the server nor we send the reply
  expect(calls[0].args.sendSchedulingMessages).toBeFalsy();
  expect(sent.length).toEqual(0);
});

test("The JMAP calendar accepts an invitation from another account's inbox", async () => {
  let { calendar, calls, sent } = setup();
  let imap = setupIMAP();
  appGlobal.calendars.add(calendar);
  appGlobal.emailAccounts.add(imap.account);
  let email = await newInvitationEMail(imap.account, kMyIMAPAddress);

  // The JMAP calendar is offered for the IMAP account, in the settings and in the invitation
  expect(imap.account.calendarsAvailable.contents).toContain(calendar);

  let invitation = calendar.getIncomingInvitationForEMail(email);
  await invitation.respondToInvitationFromMail(InvitationResponse.Accept);

  // The event lands in the JMAP calendar
  expect(calendar.events.length).toEqual(1);
  expect(calendar.events.first.calUID).toEqual(kCalUID);
  expect(calls.length).toEqual(1);
  expect(calls[0].method).toEqual("CalendarEvent/set");

  // The reply goes out via the account that received the invitation
  expect(sent.length).toEqual(0);
  expect(imap.sent.length).toEqual(1);
  expect(imap.sent[0].iCalMethod).toEqual("REPLY");
  expect(imap.sent[0].from.emailAddress).toEqual(kMyIMAPAddress);
  expect(imap.sent[0].event.participants.first.emailAddress).toEqual(kMyIMAPAddress);
  expect(imap.sent[0].event.participants.first.response).toEqual(InvitationResponse.Accept);
});

/**
 * A meeting as the JMAP server gives it to us, in JSCalendar-bis, like Stalwart does.
 * When somebody else organizes it, the server put the invitation into our calendar
 * by itself, and marks it with `isOrigin: false`.
 * @param myStatus My `participationStatus`. JSCalendar-bis defaults it to "needs-action".
 * @param organizer The email address of the organizer: `kOrganizer` or `kMe`
 */
function serverMeeting(myStatus: string | undefined, organizer = kOrganizer): TJMAPCalendarEvent {
  let participant = (emailAddress: string, status: string | undefined) => ({
    "@type": "Participant",
    calendarAddress: "mailto:" + emailAddress,
    roles: emailAddress == organizer ? { owner: true, attendee: true } : { attendee: true },
    participationStatus: status,
  });
  return {
    "@type": "Event",
    id: "serverEventID",
    uid: kCalUID,
    calendarIds: { calendarID: true },
    isOrigin: organizer == kMe,
    title: "Phone call to discuss your last visit",
    start: kStartTime.toISOString().replace(/\.\d+/, ""),
    duration: "PT30M",
    organizerCalendarAddress: "mailto:" + organizer,
    participants: {
      otherID: participant(kOrganizer, organizer == kOrganizer ? "accepted" : "needs-action"),
      meID: participant(kMe, myStatus),
    },
  } as any as TJMAPCalendarEvent;
}

test("An invitation that the JMAP server added to the calendar by itself is unanswered", () => {
  for (let myStatus of ["needs-action", undefined]) {
    let { calendar } = setup();
    let event = calendar.newEvent();
    event.fromJMAP(serverMeeting(myStatus));

    expect(event.participants.contents.map(p => p.emailAddress)).toEqual([kOrganizer, kMe]);
    expect(event.organizer.emailAddress).toEqual(kOrganizer);
    expect(event.myParticipation).toEqual(InvitationResponse.NoResponseReceived);
    expect(event.isIncomingMeeting).toBe(true);
  }
});

test("An invitation that I already answered is not unanswered", () => {
  for (let [status, response] of [
    ["accepted", InvitationResponse.Accept],
    ["tentative", InvitationResponse.Tentative],
    ["declined", InvitationResponse.Decline],
  ] as [string, InvitationResponse][]) {
    let { calendar } = setup();
    let event = calendar.newEvent();
    event.fromJMAP(serverMeeting(status));

    expect(event.myParticipation).toEqual(response);
    expect(event.isIncomingMeeting).toBe(true);
  }
});

test("A meeting that I organize is not an incoming invitation", () => {
  let { calendar } = setup();
  let event = calendar.newEvent();
  // The other person did not answer yet
  event.fromJMAP(serverMeeting("accepted", kMe));

  expect(event.organizer.emailAddress).toEqual(kMe);
  expect(event.myParticipation).toEqual(InvitationResponse.Organizer);
  expect(event.isOutgoingMeeting).toBe(true);
  expect(event.isIncomingMeeting).toBe(false);
});

test("The organizer is who `organizerCalendarAddress` names, not everybody with the owner role", () => {
  let { calendar } = setup();
  let event = calendar.newEvent();
  let json = serverMeeting(undefined);
  json.participants.meID.roles.owner = true;
  event.fromJMAP(json);

  expect(event.organizer.emailAddress).toEqual(kOrganizer);
  expect(event.myParticipation).toEqual(InvitationResponse.NoResponseReceived);
});

test("An event without other participants is not an invitation", () => {
  let { calendar } = setup();
  let event = calendar.newEvent();
  let json = serverMeeting(undefined, kMe);
  delete json.participants;
  delete json.organizerCalendarAddress;
  event.fromJMAP(json);

  expect(event.myParticipation).toEqual(InvitationResponse.Unknown);
  expect(event.isIncomingMeeting).toBe(false);
});

test("Accepting in the email a meeting that the JMAP server changed since tells the server my response", async () => {
  let { account, calendar, calls, sent } = setup();
  let event = calendar.newEvent();
  let json = serverMeeting("needs-action");
  json.updated = "2026-10-01T10:00:00Z"; // The server's copy is newer than the email
  event.fromJMAP(json);
  calendar.events.add(event);
  let email = await newInvitationEMail(account);

  await calendar.getIncomingInvitationForEMail(email).respondToInvitationFromMail(InvitationResponse.Accept);

  expect(calendar.events.length).toEqual(1);
  expect(event.myParticipation).toEqual(InvitationResponse.Accept);
  expect(event.participants.find(participant => participant.emailAddress == kMe).response).toEqual(InvitationResponse.Accept);
  let updated = calls[0].args.update.serverEventID as TJMAPCalendarEvent;
  expect(updated.participants.meID.participationStatus).toEqual("accepted");
  expect(sent.length).toEqual(1);
  expect(sent[0].event.participants.first.response).toEqual(InvitationResponse.Accept);
});

test("Accepting an invitation that the JMAP server added keeps the server's participants", async () => {
  let { account, calendar, calls, sent } = setup();
  appGlobal.emailAccounts.add(account);
  let event = calendar.newEvent();
  event.fromJMAP(serverMeeting("needs-action"));
  calendar.events.add(event);

  await event.respondToInvitation(InvitationResponse.Accept);

  expect(event.myParticipation).toEqual(InvitationResponse.Accept);

  expect(calls.length).toEqual(1);
  expect(calls[0].method).toEqual("CalendarEvent/set");
  let updated = calls[0].args.update.serverEventID as TJMAPCalendarEvent;
  // The same participant entries as the server sent, not removed and added again
  expect(Object.keys(updated.participants)).toEqual(["otherID", "meID"]);
  expect(updated.participants.meID.calendarAddress).toEqual("mailto:" + kMe);
  expect(updated.participants.meID.participationStatus).toEqual("accepted");
  expect(updated.organizerCalendarAddress).toEqual("mailto:" + kOrganizer);

  // The reply goes to the organizer, and not an invitation to everybody
  expect(sent.length).toEqual(1);
  expect(sent[0].iCalMethod).toEqual("REPLY");
  expect(sent[0].to.first.emailAddress).toEqual(kOrganizer);
});

test("Declining an invitation in the calendar without a reply tells only the server", async () => {
  let { account, calendar, calls, sent } = setup();
  appGlobal.emailAccounts.add(account);
  let event = calendar.newEvent();
  event.fromJMAP(serverMeeting("needs-action"));
  calendar.events.add(event);

  await event.respondToInvitation(InvitationResponse.Decline, false);

  expect(event.myParticipation).toEqual(InvitationResponse.Decline);
  expect(calls.length).toEqual(1);
  expect(calls[0].method).toEqual("CalendarEvent/set");
  let updated = calls[0].args.update.serverEventID as TJMAPCalendarEvent;
  expect(updated.participants.meID.participationStatus).toEqual("declined");
  expect(calls[0].args.sendSchedulingMessages).toBeFalsy();
  expect(sent.length).toEqual(0);
});

test("A mail about a meeting goes to the organizer, or to all attendees except me", () => {
  const kOtherAttendee = "user3@example.com";
  let { account, calendar } = setup();
  appGlobal.emailAccounts.add(account);
  let event = calendar.newEvent();
  event.fromJMAP(serverMeeting("needs-action"));
  event.participants.add(new Participant(kOtherAttendee, "User 3", InvitationResponse.NoResponseReceived));

  let toOrganizer = IncomingInvitation.replyToEventByMail(event, false);
  expect(toOrganizer.to.contents.map(person => person.emailAddress)).toEqual([kOrganizer]);
  expect(toOrganizer.subject).toContain(event.title);

  let toAll = IncomingInvitation.replyToEventByMail(event, true);
  expect(new Set(toAll.to.contents.map(person => person.emailAddress))).toEqual(new Set([kOrganizer, kOtherAttendee]));
});
