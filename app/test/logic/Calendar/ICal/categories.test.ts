// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { Event } from "../../../../logic/Calendar/Event";
import { convertICalToEvent } from "../../../../logic/Calendar/ICal/ICalToEvent";
import { getICal } from "../../../../logic/Calendar/ICal/ICalGenerator";
import { getTagByName } from "../../../../logic/Abstract/Tag";
import { expect, test } from "vitest";

/** @param categories the `CATEGORIES` lines, RFC 5545 3.8.1.2 */
function eventWithCategories(...categories: string[]): Event {
  let event = new Event();
  convertICalToEvent([
    "BEGIN:VCALENDAR",
    "BEGIN:VEVENT",
    "UID:1@example.com",
    "DTSTAMP:20260910T100000Z",
    "DTSTART:20260910T100000Z",
    "DTEND:20260910T110000Z",
    "SUMMARY:Meeting",
    ...categories,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n"), event);
  return event;
}

function tagNames(event: Event): string[] {
  return event.tags.contents.map(tag => tag.name);
}

function newEvent(): Event {
  let event = new Event();
  event.calUID = "2@example.com";
  event.title = "Planning";
  event.startTime = new Date("2026-09-10T10:00:00Z");
  event.endTime = new Date("2026-09-10T11:00:00Z");
  event.timezone = "UTC";
  return event;
}

test("Read the tags, with several in one line and in several lines", () => {
  let event = eventWithCategories("CATEGORIES:Customer,Travel", "CATEGORIES;LANGUAGE=en:Project X");

  expect(tagNames(event)).toContain("Customer");
  expect(tagNames(event)).toContain("Travel");
  expect(tagNames(event)).toContain("Project X");
  expect(event.tags.length).toBe(3);
});

test("A comma in a tag name stays part of the name", () => {
  let event = eventWithCategories("CATEGORIES:Smith\\, John,Travel");

  expect(tagNames(event)).toContain("Smith, John");
  expect(tagNames(event)).toContain("Travel");
  expect(tagNames(event)).not.toContain("Smith");
});

test("An event without categories has no tags", () => {
  let event = eventWithCategories();

  expect(event.tags.isEmpty).toBe(true);
});

test("The tags survive saving and reading the event, also with a comma in a name", async () => {
  let event = newEvent();
  event.tags.addAll([getTagByName("Customer"), getTagByName("Smith, John")]);

  let reread = new Event();
  convertICalToEvent(await getICal(event), reread);

  expect(tagNames(reread)).toContain("Customer");
  expect(tagNames(reread)).toContain("Smith, John");
  expect(reread.tags.length).toBe(2);
});

test("An invitation does not tell the attendees the tags of the organizer", async () => {
  let event = newEvent();
  event.tags.add(getTagByName("Boring"));

  let ics = await getICal(event, "REQUEST");

  expect(ics).not.toContain("CATEGORIES");
  expect(ics).not.toContain("Boring");
});
