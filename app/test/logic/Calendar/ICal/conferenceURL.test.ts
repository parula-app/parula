// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { Event } from "../../../../logic/Calendar/Event";
import { convertICalToEvent } from "../../../../logic/Calendar/ICal/ICalToEvent";
import { expect, test } from "vitest";

/** @param conference the `CONFERENCE` lines, in the order the sender wrote them */
function eventWithConference(...conference: string[]): Event {
  let event = new Event();
  convertICalToEvent([
    "BEGIN:VCALENDAR",
    "BEGIN:VEVENT",
    "UID:1@example.com",
    "DTSTAMP:20260910T100000Z",
    "DTSTART:20260910T100000Z",
    "DTEND:20260910T110000Z",
    "SUMMARY:Meeting",
    ...conference,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n"), event);
  return event;
}

test("Take the video link, not the phone dial-in that is listed before it", () => {
  // <https://www.rfc-editor.org/rfc/rfc7986#section-5.11>, its own example order
  let event = eventWithConference(
    `CONFERENCE;VALUE=URI;FEATURE=PHONE;LABEL="Dial-in":tel:+1-412-555-0123`,
    "CONFERENCE;VALUE=URI;FEATURE=VIDEO:https://video.example.com/join/1234");

  expect(event.onlineMeetingURL).toBe("https://video.example.com/join/1234");
});

test("A meeting URL with a dangerous scheme is dropped, and the event survives", () => {
  let event = eventWithConference("CONFERENCE;VALUE=URI:javascript:alert(1)");

  expect(event.onlineMeetingURL).toBe(null);
  expect(event.title).toBe("Meeting");
});
