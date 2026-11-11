// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../logic/app";
import { Event } from "../../../logic/Calendar/Event";
import { UniqueEvents } from "../../../frontend/Calendar/UniqueEvents";
import { ArrayColl } from "svelte-collections";
import { expect, test } from "vitest";

function newEvent(title: string, calUID: string | null, recurrenceStartTime: Date | null = null): Event {
  let event = new Event();
  event.title = title;
  event.calUID = calUID;
  event.recurrenceStartTime = recurrenceStartTime;
  return event;
}

test("The same meeting in 2 calendars is shown once", () => {
  let mine = newEvent("Mine", "meeting");
  let shared = newEvent("Shared", "meeting");
  let unique = new UniqueEvents(new ArrayColl([mine, shared]));
  expect(unique.contents).toEqual([mine]);
});

test("Events without calUID are all shown", () => {
  let a = newEvent("A", null);
  let b = newEvent("B", null);
  let unique = new UniqueEvents(new ArrayColl([a, b]));
  expect(unique.contents).toEqual([a, b]);
});

test("All occurrences of a recurring meeting are shown, but each only once", () => {
  let monday = new Date(2026, 9, 12, 10);
  let tuesday = new Date(2026, 9, 13, 10);
  let mineMonday = newEvent("Mine Monday", "series", monday);
  let mineTuesday = newEvent("Mine Tuesday", "series", tuesday);
  let sharedMonday = newEvent("Shared Monday", "series", new Date(monday));
  let unique = new UniqueEvents(new ArrayColl([mineMonday, mineTuesday, sharedMonday]));
  expect(unique.contents).toEqual([mineMonday, mineTuesday]);
});

test("Duplicates added later are not shown", () => {
  let mine = newEvent("Mine", "meeting");
  let source = new ArrayColl([mine]);
  let unique = new UniqueEvents(source);
  source.add(newEvent("Shared", "meeting"));
  expect(unique.contents).toEqual([mine]);
});

test("Removing the shown event shows its duplicate instead", () => {
  let mine = newEvent("Mine", "meeting");
  let shared = newEvent("Shared", "meeting");
  let source = new ArrayColl([mine, shared]);
  let unique = new UniqueEvents(source);
  source.remove(mine);
  expect(unique.contents).toEqual([shared]);
  source.remove(shared);
  expect(unique.contents).toEqual([]);
});

test("Removing the hidden duplicate keeps the shown event", () => {
  let mine = newEvent("Mine", "meeting");
  let shared = newEvent("Shared", "meeting");
  let source = new ArrayColl([mine, shared]);
  let unique = new UniqueEvents(source);
  source.remove(shared);
  expect(unique.contents).toEqual([mine]);
  source.remove(mine);
  expect(unique.contents).toEqual([]);
});

test("Removing all duplicates at once removes the event", () => {
  let other = newEvent("Other", "other");
  let mine = newEvent("Mine", "meeting");
  let shared = newEvent("Shared", "meeting");
  let third = newEvent("Third", "meeting");
  let source = new ArrayColl([other, mine, shared, third]);
  let unique = new UniqueEvents(source);
  source.removeAll([shared, mine, third]);
  expect(unique.contents).toEqual([other]);
});

test("Removing an event works after its calUID was set", () => {
  let event = newEvent("New", null);
  let source = new ArrayColl([event]);
  let unique = new UniqueEvents(source);
  event.calUID = "assigned when saving";
  source.remove(event);
  expect(unique.contents).toEqual([]);
});
