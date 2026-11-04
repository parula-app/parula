// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { IMAPAccount } from "../../../../logic/Mail/IMAP/IMAPAccount";
import { CalDAVCalendar } from "../../../../logic/Calendar/CalDAV/CalDAVCalendar";
import type { CalDAVEvent } from "../../../../logic/Calendar/CalDAV/CalDAVEvent";
import { AuthMethod } from "../../../../logic/Abstract/Account";
import { Participant } from "../../../../logic/Calendar/Participant";
import { InvitationResponse } from "../../../../logic/Calendar/Invitation/InvitationStatus";
import { DummyCalendarStorage } from "../../../../logic/Calendar/SQL/DummyCalendarStorage";
import type { EMail } from "../../../../logic/Mail/EMail";
import { SpecialFolder } from "../../../../logic/Mail/Folder";
import { MailIdentity } from "../../../../logic/Mail/MailIdentity";
import { afterEach, beforeAll, expect, test } from "vitest";

/* A colleague who shares their account with me invites me. I have an identity
 * for their address, too, in their shared account. The answer to an invitation in
 * my calendar must come from me, not fail because both of us are participants. */

const kMe = "calendar-bob@example.com";
const kOrganizer = "calendar-alice@example.com";
const kCalendarURL = "https://dav.example.com/calendars/bob/";
const kStartTime = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

beforeAll(() => {
  let noServer = () => { throw new Error("The test should not talk to a server"); };
  appGlobal.remoteApp ??= {
    kyCreate: noServer,
    createIMAPFlowConnection: noServer,
  } as any;
});

afterEach(() => {
  appGlobal.calendars.clear();
  appGlobal.emailAccounts.clear();
});

/** A mail account with an identity for `emailAddress`, with the sent mails captured */
function mailAccount(emailAddress: string) {
  let account = new IMAPAccount();
  account.emailAddress = emailAddress;
  let identity = new MailIdentity(account);
  identity.emailAddress = emailAddress;
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
  return { account, sent };
}

/** My CalDAV calendar, which belongs to my mail account, and the invitation in it */
function setup() {
  let me = mailAccount(kMe);
  let sharedByOrganizer = mailAccount(kOrganizer);

  let calendar = new CalDAVCalendar();
  calendar.name = "Bob";
  calendar.mainAccount = me.account;
  calendar.calendarURL = kCalendarURL;
  calendar.authMethod = AuthMethod.Password;
  calendar.password = "test";
  calendar.storage = new DummyCalendarStorage();
  // `login()` returns early when we already have a client
  calendar.client = {
    updateCalendarObject: async () => new Response(null, { status: 204 }),
  } as any;
  appGlobal.calendars.add(calendar);

  let event = calendar.newEvent() as CalDAVEvent;
  event.calUID = "c3edf21c-a0f3-4ad2-b6e4-1edf565c59bf";
  event.url = kCalendarURL + event.calUID + ".ics";
  event.title = "Project meeting";
  event.startTime = new Date(kStartTime);
  event.endTime = new Date(kStartTime.getTime() + 60 * 60 * 1000);
  event.participants.add(new Participant(kOrganizer, "Alice", InvitationResponse.Organizer));
  event.participants.add(new Participant(kMe, "Bob", InvitationResponse.NoResponseReceived));
  event.myParticipation = InvitationResponse.NoResponseReceived;
  calendar.events.add(event);
  return { event, sent: me.sent, sentByShared: sharedByOrganizer.sent };
}

test("Answering an invitation from a user who shares their account with me", async () => {
  let { event, sent, sentByShared } = setup();

  await event.respondToInvitation(InvitationResponse.Accept);

  expect(event.myParticipation).toEqual(InvitationResponse.Accept);
  expect(sentByShared.length).toEqual(0);
  expect(sent.length).toEqual(1);
  expect(sent[0].from.emailAddress).toEqual(kMe);
  expect(sent[0].to.contents.map(person => person.emailAddress)).toEqual([kOrganizer]);
  expect(sent[0].event.participants.contents.map(p => [p.emailAddress, p.response])).toEqual([[kMe, InvitationResponse.Accept]]);
});
