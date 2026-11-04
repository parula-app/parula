// @vitest-environment happy-dom
// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../logic/app";
import { Event } from "../../../logic/Calendar/Event";
import { EventDrag, type EventDragMode } from "../../Calendar/EventDrag";
import { beforeAll, expect, test } from "vitest";

beforeAll(() => {
  // The drag finds the day under the pointer; these tests set the deltas directly
  document.elementsFromPoint = () => [];
});

function newEvent(start: Date, end: Date): Event {
  let event = new Event();
  event.startTime = start;
  event.endTime = end;
  return event;
}

function drag(event: Event, mode: EventDragMode, deltaMinutes: number, deltaDays = 0): EventDrag {
  let pointer = { clientX: 100, clientY: 100 } as PointerEvent;
  let eventDrag = new EventDrag(event, mode, pointer, 0.8, 15);
  eventDrag.hasMoved = true;
  eventDrag.deltaMinutes = deltaMinutes;
  eventDrag.deltaDays = deltaDays;
  return eventDrag;
}

test("Move keeps the duration", () => {
  let event = newEvent(new Date(2026, 9, 15, 9), new Date(2026, 9, 15, 10, 30));
  let { start, end } = drag(event, "move", 45, 1).newTimes();
  expect(start).toEqual(new Date(2026, 9, 16, 9, 45));
  expect(end).toEqual(new Date(2026, 9, 16, 11, 15));
});

test("Move to another day keeps the time of day across the change of daylight saving time", () => {
  // Europe and the US change the clocks in late March and late October
  let event = newEvent(new Date(2026, 2, 27, 9), new Date(2026, 2, 27, 10));
  let { start, end } = drag(event, "move-days", 0, 7).newTimes();
  expect(start).toEqual(new Date(2026, 3, 3, 9));
  expect(end).toEqual(new Date(2026, 3, 3, 10));
});

test("Resizing the end keeps at least one snap step", () => {
  let event = newEvent(new Date(2026, 9, 15, 9), new Date(2026, 9, 15, 10));
  expect(drag(event, "resize-end", 30).newTimes().end).toEqual(new Date(2026, 9, 15, 10, 30));
  expect(drag(event, "resize-end", -120).newTimes().end).toEqual(new Date(2026, 9, 15, 9, 15));
  expect(drag(event, "resize-end", -120).newTimes().start).toEqual(new Date(2026, 9, 15, 9));
});

test("Resizing the start keeps at least one snap step", () => {
  let event = newEvent(new Date(2026, 9, 15, 9), new Date(2026, 9, 15, 10));
  expect(drag(event, "resize-start", -30).newTimes().start).toEqual(new Date(2026, 9, 15, 8, 30));
  expect(drag(event, "resize-start", 120).newTimes().start).toEqual(new Date(2026, 9, 15, 9, 45));
});

test("A click without movement doesn't change the time", () => {
  let event = newEvent(new Date(2026, 9, 15, 9), new Date(2026, 9, 15, 10));
  let eventDrag = drag(event, "move", 0, 0);
  expect(eventDrag.changesTime).toBe(false);
  eventDrag.move({ clientX: 102, clientY: 101 } as PointerEvent);
  expect(eventDrag.changesTime).toBe(false);
});

test("Moving the pointer snaps to the time steps", () => {
  let event = newEvent(new Date(2026, 9, 15, 9), new Date(2026, 9, 15, 10));
  let eventDrag = new EventDrag(event, "resize-end", { clientX: 100, clientY: 100 } as PointerEvent, 0.8, 15);
  // 0.8 px per minute: 20 px = 25 minutes -> 30 minutes
  eventDrag.move({ clientX: 100, clientY: 120 } as PointerEvent);
  expect(eventDrag.deltaMinutes).toBe(30);
  expect(eventDrag.changesTime).toBe(true);
});

test("Dropping on a day of the date navigator moves the event to that day, at the same time", () => {
  let event = newEvent(new Date(2026, 9, 15, 9), new Date(2026, 9, 15, 10, 30));
  let navigatorDay = document.createElement("button");
  navigatorDay.dataset.navDay = String(new Date(2026, 9, 20).getTime());
  document.elementsFromPoint = () => [ navigatorDay ];
  try {
    let eventDrag = new EventDrag(event, "move", { clientX: 100, clientY: 100 } as PointerEvent, 0.8, 15);
    eventDrag.move({ clientX: 300, clientY: 40 } as PointerEvent);
    expect(eventDrag.deltaMinutes).toBe(0);
    expect(eventDrag.deltaDays).toBe(5);
    expect(eventDrag.newTimes()).toEqual({ start: new Date(2026, 9, 20, 9), end: new Date(2026, 9, 20, 10, 30) });
    let block = document.createElement("div");
    eventDrag.preview(block);
    expect(navigatorDay.classList.contains("drop-target")).toBe(true);
    eventDrag.endPreview(block);
    expect(navigatorDay.classList.contains("drop-target")).toBe(false);
  } finally {
    document.elementsFromPoint = () => [];
  }
  expect(EventDrag.daysBetween(new Date(2026, 9, 24, 23), new Date(2026, 9, 26, 1))).toBe(2);
});
