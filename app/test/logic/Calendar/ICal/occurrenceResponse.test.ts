// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { Calendar } from "../../../../logic/Calendar/Calendar";
import type { Event } from "../../../../logic/Calendar/Event";
import { ICalEMailProcessor } from "../../../../logic/Calendar/ICal/ICalEMailProcessor";
import { InvitationResponse } from "../../../../logic/Calendar/Invitation/InvitationStatus";
import { DummyCalendarStorage } from "../../../../logic/Calendar/SQL/DummyCalendarStorage";
import { IMAPAccount } from "../../../../logic/Mail/IMAP/IMAPAccount";
import type { EMail } from "../../../../logic/Mail/EMail";
import { SpecialFolder } from "../../../../logic/Mail/Folder";
import { MailIdentity } from "../../../../logic/Mail/MailIdentity";
import { afterEach, beforeAll, expect, test } from "vitest";

const kMe = "worker@example.com";
const kOrganizer = "chief@example.com";
const k1Hour = 60 * 60 * 1000;
/** In the future, because we don't reply to past meetings */
const kStartTime = new Date(Math.ceil((Date.now() + 7 * 24 * k1Hour) / k1Hour) * k1Hour);

function toICalDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
}

function meetingICal(method: "REQUEST" | "CANCEL", extraLines: string[] = []): string {
  return [
    "BEGIN:VCALENDAR",
    "PRODID:-//Example/ExampleCalendarClient//EN",
    "METHOD:" + method,
    "VERSION:2.0",
    "BEGIN:VEVENT",
    "UID:meeting-1234@example.com",
    "DTSTAMP:" + (method == "CANCEL" ? "20260902T100000Z" : "20260901T100000Z"),
    "DTSTART:" + toICalDate(kStartTime),
    "DTEND:" + toICalDate(new Date(kStartTime.getTime() + k1Hour)),
    "SUMMARY:Planning",
    "ORGANIZER;CN=Chief:mailto:" + kOrganizer,
    "ATTENDEE;ROLE=CHAIR;PARTSTAT=ACCEPTED;CN=Chief:mailto:" + kOrganizer,
    "ATTENDEE;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN=Worker:mailto:" + kMe,
    ...extraLines,
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
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

/** The invitation email arrives in the inbox, and we parse it, like `EMail.parseMIME()` does */
async function receive(account: IMAPAccount, ics: string): Promise<EMail> {
  let email = account.getSpecialFolder(SpecialFolder.Inbox).newEMail();
  let attachment = email.newAttachment();
  attachment.fromFile(new File([ics], "invite.ics", { type: "text/calendar" }));
  email.attachments.add(attachment);
  await new ICalEMailProcessor().process(email);
  return email;
}

/** The user accepted the invitation in the email */
async function acceptedMeeting(extraLines: string[] = []) {
  let setupResult = setup();
  let { account, calendar, sent } = setupResult;
  let email = await receive(account, meetingICal("REQUEST", extraLines));
  await calendar.getIncomingInvitationForEMail(email).respondToInvitationFromMail(InvitationResponse.Accept);
  expect(calendar.events.length).toEqual(1);
  expect(sent.length).toEqual(1);
  return { ...setupResult, event: calendar.events.first };
}

const k1Week = 7 * 24 * 60 * 60 * 1000;

function myResponse(event: Event): InvitationResponse {
  return event.participants.find(participant => participant.emailAddress == kMe).response;
}

test("Declining one occurrence of an accepted series keeps the rest of the series accepted", async () => {
  let { event: master } = await acceptedMeeting(["RRULE:FREQ=WEEKLY;COUNT=4"]);
  let occurrence = master.getOccurrenceByDate(new Date(kStartTime.getTime() + k1Week));

  await occurrence.respondToInvitation(InvitationResponse.Decline);

  expect(occurrence.myParticipation).toEqual(InvitationResponse.Decline);
  expect(myResponse(occurrence)).toEqual(InvitationResponse.Decline);
  expect(master.myParticipation).toEqual(InvitationResponse.Accept);
  expect(myResponse(master)).toEqual(InvitationResponse.Accept);
  let nextOccurrence = master.getOccurrenceByDate(new Date(kStartTime.getTime() + 2 * k1Week));
  expect(myResponse(nextOccurrence)).toEqual(InvitationResponse.Accept);
});
