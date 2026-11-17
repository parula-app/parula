// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { OWAEvent } from "../../../../logic/Calendar/OWA/OWAEvent";
import { expect, test } from "vitest";

/** Exchange returns X.500 addresses for the attendees of an internal meeting */
const kX500 = "/o=Sibvaleo/ou=Exchange Administrative Group (FYDIBOHF23SPDLT)/cn=Recipients/cn=userd41723b4";

function eventFromJSON(organizer: string, attendee: string): OWAEvent {
  let event = new OWAEvent();
  event.fromJSON({
    ItemId: { Id: "AAMkAGItem=" },
    Subject: "Planning",
    Start: "2026-07-14T10:00:00Z",
    End: "2026-07-14T11:00:00Z",
    Organizer: { Mailbox: { EmailAddress: organizer, Name: "Organizer" } },
    RequiredAttendees: [{ Mailbox: { EmailAddress: attendee, Name: "Attendee" }, ResponseType: "Accept" }],
  });
  return event;
}

test("Event with email addresses", () => {
  let event = eventFromJSON("chief@example.com", "worker@example.com");
  expect(event.participants.contents.map(p => p.emailAddress)).toEqual(["chief@example.com", "worker@example.com"]);
});

test("Event with an X.500 organizer", () => {
  let event = eventFromJSON(kX500, "worker@example.com");
  expect(event.title).toBe("Planning");
  expect(event.participants.contents.map(p => p.emailAddress)).toEqual(["worker@example.com"]);
});
