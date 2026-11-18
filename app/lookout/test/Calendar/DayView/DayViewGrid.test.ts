// @vitest-environment happy-dom
// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../../logic/app";
import { Event } from "../../../../logic/Calendar/Event";
import { CalendarRange } from "../../../Calendar/CalendarRange";
import DayViewGrid from "../../../Calendar/DayView/DayViewGrid.svelte";
import { eventPeek } from "../../../Calendar/selected";
import { ArrayColl } from "svelte-collections";
import { flushSync, mount, unmount } from "svelte";
import { get } from "svelte/store";
import { afterEach, beforeAll, expect, test } from "vitest";

beforeAll(() => {
  (globalThis as any).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  HTMLCanvasElement.prototype.getContext = (() => null) as any;
  Element.prototype.scrollTo ??= () => {};
});

afterEach(() => {
  eventPeek.set(null);
  document.body.innerHTML = "";
});

// Monday, 2026-10-05
const kMonday = new Date(2026, 9, 5);

test("A scroll event that arrives after the week view was closed causes no error", () => {
  let meeting = new Event();
  meeting.title = "Meeting";
  meeting.startTime = new Date(2026, 9, 6, 10);
  meeting.endTime = new Date(2026, 9, 6, 11);
  let grid = mount(DayViewGrid, { target: document.body, props: {
    range: new CalendarRange("week", kMonday),
    groups: [{ calendar: null, events: new ArrayColl([meeting]) }],
  } });
  flushSync();
  let timeGrid = document.querySelector(".time-grid");
  expect(timeGrid).toBeTruthy();

  let errors: Error[] = [];
  function onError(errorEvent: ErrorEvent) {
    errors.push(errorEvent.error);
  }
  window.addEventListener("error", onError);
  try {
    // The browser fires the scroll event of a scroll only with the next frame,
    // e.g. during a smooth scroll. Double-clicking an event closes the view before that frame.
    unmount(grid);
    timeGrid.dispatchEvent(new window.Event("scroll"));
  } finally {
    window.removeEventListener("error", onError);
  }
  expect(errors).toEqual([]);
});

test("Scrolling the week view closes the event popup", () => {
  let grid = mount(DayViewGrid, { target: document.body, props: {
    range: new CalendarRange("week", kMonday),
    groups: [{ calendar: null, events: new ArrayColl<Event>() }],
  } });
  flushSync();
  eventPeek.set({ event: new Event(), anchor: document.createElement("div") });
  document.querySelector(".time-grid").dispatchEvent(new window.Event("scroll"));
  expect(get(eventPeek)).toBeNull();
  unmount(grid);
});
