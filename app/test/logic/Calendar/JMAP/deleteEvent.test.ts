// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { JMAPAccount } from "../../../../logic/Mail/JMAP/JMAPAccount";
import { JMAPCalendar } from "../../../../logic/Calendar/JMAP/JMAPCalendar";
import type { JMAPEvent } from "../../../../logic/Calendar/JMAP/JMAPEvent";
import type { TJMAPCalendarEvent } from "../../../../logic/Calendar/JMAP/TJSCalendar";
import { InvitationResponse } from "../../../../logic/Calendar/Invitation/InvitationStatus";
import { DummyCalendarStorage } from "../../../../logic/Calendar/SQL/DummyCalendarStorage";
import type { EMail } from "../../../../logic/Mail/EMail";
import { SpecialFolder } from "../../../../logic/Mail/Folder";
import { MailIdentity } from "../../../../logic/Mail/MailIdentity";
import { afterEach, beforeAll, expect, test } from "vitest";

const kMe = "calendar-alice@example.com";
const kAttendee = "calendar-bob@example.com";
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

/** A JMAP account with my identity and a JMAP calendar, with the server calls and sent mails captured.
 * Stalwart does not send scheduling messages unless asked, so our client must send them.
 * @param destroyResponse what the server answers to `CalendarEvent/set destroy` */
function setup(destroyResponse: (id: string) => any = id => ({ destroyed: [id] })) {
  let account = new JMAPAccount();
  account.emailAddress = kMe;
  account.realname = "Alice";
  account.accountID = "u";
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
  let calls: { method: string, args: any }[] = [];
  account.makeSingleCall = async (method: string, args: any) => {
    calls.push({ method, args });
    return { accountId: "u", oldState: "s1", newState: "s2", ...destroyResponse(args.destroy[0]) };
  };
  let sent: EMail[] = [];
  account.send = async (email: EMail) => {
    sent.push(email);
  };

  let calendar = new JMAPCalendar();
  calendar.initFromMainAccount(account);
  calendar.jmapID = "b";
  calendar.storage = new DummyCalendarStorage();
  appGlobal.calendars.add(calendar);
  return { calendar, calls, sent };
}

/** A meeting as Stalwart returns it from `CalendarEvent/get` */
function serverMeeting(organizer: string, myStatus: string): TJMAPCalendarEvent {
  return {
    "@type": "Event",
    id: "e",
    uid: "c3edf21c-a0f3-4ad2-b6e4-1edf565c59bf",
    calendarIds: { b: true },
    isDraft: false,
    isOrigin: organizer == kMe,
    title: "Project meeting",
    start: kStartTime.toISOString().replace(/\.\d+Z$/, ""),
    duration: "PT1H",
    sequence: 0,
    organizerCalendarAddress: "mailto:" + organizer,
    participants: {
      "92f6ff39-1ef7-4784-8081-d514dcd744f0": {
        "@type": "Participant",
        calendarAddress: "mailto:" + kMe,
        name: "Alice",
        participationStatus: organizer == kMe ? "accepted" : myStatus,
        ...(organizer == kMe ? { roles: { owner: true } } : {}),
      },
      "fbcf2288-5a44-4c3c-abe8-552619ac3d37": {
        "@type": "Participant",
        calendarAddress: "mailto:" + kAttendee,
        name: "Bob",
        participationStatus: organizer == kMe ? "needs-action" : "accepted",
        ...(organizer == kAttendee ? { roles: { owner: true } } : {}),
      },
    },
  } as any as TJMAPCalendarEvent;
}

/** The calls that deleted the event `e` on the server */
function destroyCalls(calls: { method: string, args: any }[]) {
  return calls.filter(call => call.method == "CalendarEvent/set" && call.args.destroy?.includes("e"));
}

/** Whether the server was asked to send the scheduling messages itself (draft-ietf-jmap-calendars 5.9.2) */
function serverSends(calls: { method: string, args: any }[]): boolean {
  return destroyCalls(calls).some(call => call.args.sendSchedulingMessages);
}

function addEvent(calendar: JMAPCalendar, json: TJMAPCalendarEvent): JMAPEvent {
  let event = calendar.newEvent();
  event.fromJMAP(json);
  calendar.events.add(event);
  return event;
}

test("Deleting a meeting that I organize cancels it for the attendees", async () => {
  let { calendar, calls, sent } = setup();
  let event = addEvent(calendar, serverMeeting(kMe, "accepted"));
  expect(event.isOutgoingMeeting).toBe(true);

  await event.deleteIt();

  expect(destroyCalls(calls).length).toBeGreaterThan(0);
  // We send the cancellation, or we asked the server to send it
  let cancellations = sent.filter(email => email.iCalMethod == "CANCEL");
  let recipients = cancellations.flatMap(email => email.to.contents.map(person => person.emailAddress));
  expect(recipients.includes(kAttendee) || serverSends(calls)).toBe(true);
  expect(recipients).not.toContain(kMe);
});

test("Deleting an invitation declines it", async () => {
  let { calendar, calls, sent } = setup();
  let event = addEvent(calendar, serverMeeting(kAttendee, "accepted"));
  expect(event.isIncomingMeeting).toBe(true);

  await event.deleteIt();

  expect(destroyCalls(calls).length).toBeGreaterThan(0);
  // We send the decline to the organizer, or we asked the server to send it
  let declines = sent.filter(email => email.iCalMethod == "REPLY" &&
    email.to.contents.some(person => person.emailAddress == kAttendee) &&
    email.event.participants.find(participant => participant.emailAddress == kMe)?.response == InvitationResponse.Decline);
  expect(declines.length > 0 || serverSends(calls)).toBe(true);
});

test("Nothing is sent when the server refuses to delete the meeting", async () => {
  let { calendar, sent } = setup(id => ({ notDestroyed: { [id]: { type: "forbidden", description: "You may not delete this event" } } }));
  let event = addEvent(calendar, serverMeeting(kMe, "accepted"));

  await expect(event.deleteIt()).rejects.toThrow("You may not delete this event");
  expect(sent.length).toBe(0);
});

test("Deleting an event without participants sends nothing", async () => {
  let { calendar, calls, sent } = setup();
  let json = serverMeeting(kMe, "accepted");
  delete json.participants;
  delete json.organizerCalendarAddress;
  let event = addEvent(calendar, json);

  await event.deleteIt();

  expect(destroyCalls(calls).length).toBeGreaterThan(0);
  expect(sent.length).toBe(0);
});
