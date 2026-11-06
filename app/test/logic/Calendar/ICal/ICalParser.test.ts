// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { Event } from "../../../../logic/Calendar/Event";
import { ICalParser } from "../../../../logic/Calendar/ICal/ICalParser";
import { convertICalToEvents } from "../../../../logic/Calendar/ICal/ICalToEvent";
import { expect, test } from "vitest";

test("Each container lists only its direct children", () => {
  let parsed = new ICalParser([
    "BEGIN:VCALENDAR",
    "BEGIN:VTIMEZONE",
    "TZID:Europe/Berlin",
    "BEGIN:STANDARD",
    "TZOFFSETTO:+0100",
    "END:STANDARD",
    "END:VTIMEZONE",
    "BEGIN:VEVENT",
    "UID:event-1",
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n"));
  expect(Object.keys(parsed.containers)).toEqual(["vcalendar"]);
  let vcalendar = parsed.containers.vcalendar[0];
  expect(Object.keys(vcalendar.containers).sort()).toEqual(["vevent", "vtimezone"]);
  let vevent = vcalendar.containers.vevent[0];
  expect(vevent.parent).toBe(vcalendar);
  expect(vevent.entries.uid[0].value).toBe("event-1");
  expect(Object.keys(vevent.containers)).toEqual(["valarm"]);
  expect(vevent.containers.valarm[0].entries.action[0].value).toBe("DISPLAY");
  expect(vevent.entries.action).toBeUndefined();
  expect(vcalendar.containers.vtimezone[0].containers.standard).toHaveLength(1);
});

test("The import reads the events of all VCALENDARs", () => {
  // e.g. several .ics files concatenated
  let events = convertICalToEvents([
    "BEGIN:VCALENDAR",
    "BEGIN:VEVENT",
    "UID:event-1",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:event-2",
    "END:VEVENT",
    "END:VCALENDAR",
    "BEGIN:VCALENDAR",
    "BEGIN:VEVENT",
    "UID:event-3",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n"), () => new Event(), ex => { throw ex; });
  expect(events.map(event => event.calUID).sort()).toEqual(["event-1", "event-2", "event-3"]);
});

test("A vCard inside a vCard is no separate contact", () => {
  // vCard 2.1 AGENT can contain the vCard of the assistant
  let parsed = new ICalParser([
    "BEGIN:VCARD",
    "VERSION:2.1",
    "FN:Boss",
    "AGENT:",
    "BEGIN:VCARD",
    "VERSION:2.1",
    "FN:Assistant",
    "END:VCARD",
    "END:VCARD",
  ].join("\r\n"));
  expect(parsed.containers.vcard).toHaveLength(1);
  expect(parsed.containers.vcard[0].entries.fn[0].value).toBe("Boss");
});

test("END must match BEGIN", () => {
  expect(() => new ICalParser("BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nEND:VCALENDAR")).toThrow();
  expect(() => new ICalParser("END:VEVENT")).toThrow();
  expect(() => new ICalParser("BEGIN:VEVENT\r\nEND:VEVENT\r\nEND:VEVENT")).toThrow();
});
