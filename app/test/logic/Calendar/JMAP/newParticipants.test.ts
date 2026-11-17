// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { JMAPAccount } from "../../../../logic/Mail/JMAP/JMAPAccount";
import { JMAPCalendar } from "../../../../logic/Calendar/JMAP/JMAPCalendar";
import type { TJMAPCalendarEvent } from "../../../../logic/Calendar/JMAP/TJSCalendar";
import { Participant } from "../../../../logic/Calendar/Participant";
import { InvitationResponse } from "../../../../logic/Calendar/Invitation/InvitationStatus";
import { DummyCalendarStorage } from "../../../../logic/Calendar/SQL/DummyCalendarStorage";
import { beforeAll, expect, test } from "vitest";

beforeAll(() => {
  appGlobal.remoteApp ??= {
    kyCreate: () => { throw new Error("The test should not talk to a real server"); },
  } as any;
});

test("A new meeting has JSCalendar-bis participants: the organizer has accepted, the attendees are asked to reply", async () => {
  // draft-ietf-calext-jscalendarbis §A.2.3: The "attendee" role got removed.
  // Every participant with a `calendarAddress` is an attendee in iCalendar.
  let account = new JMAPAccount();
  account.accountID = "u";
  let calendar = new JMAPCalendar();
  calendar.initFromMainAccount(account);
  calendar.jmapID = "b";
  calendar.storage = new DummyCalendarStorage();
  let created: TJMAPCalendarEvent;
  account.makeSingleCall = async (method: string, args: any) => {
    created = Object.values(args.create)[0] as TJMAPCalendarEvent;
    return { created: { [Object.keys(args.create)[0]]: { id: "e" } } };
  };
  let event = calendar.newEvent();
  event.title = "Meeting";
  event.startTime = new Date("2026-11-20T09:00:00Z");
  event.endTime = new Date("2026-11-20T10:00:00Z");
  event.participants.add(new Participant("alice@example.com", "Alice", InvitationResponse.Organizer));
  event.participants.add(new Participant("bob@example.com", "Bob", InvitationResponse.NoResponseReceived));
  calendar.events.add(event);
  event.sendInvitationsDirectly = async () => {}; // not this test

  await event.save();

  // The scheme of a calendar address is case-insensitive
  let isAddress = (calendarAddress: string | undefined, email: string) => calendarAddress?.toLowerCase() == "mailto:" + email;
  let participants = Object.values(created.participants);
  let alice = participants.find(p => isAddress(p.calendarAddress, "alice@example.com"));
  let bob = participants.find(p => isAddress(p.calendarAddress, "bob@example.com"));
  expect(alice).toMatchObject({ roles: { owner: true }, participationStatus: "accepted" });
  expect(bob.expectReply).toBe(true);
  expect(bob.participationStatus ?? "needs-action").toBe("needs-action");
  expect(Object.keys(bob.roles ?? {})).not.toContain("attendee");
  expect(Object.keys(bob.roles ?? {})).not.toContain("owner");
  // The server sets the organizer, if we don't (draft-ietf-jmap-calendars §5.9)
  if (created.organizerCalendarAddress) {
    expect(isAddress(created.organizerCalendarAddress, "alice@example.com")).toBe(true);
  }
});
