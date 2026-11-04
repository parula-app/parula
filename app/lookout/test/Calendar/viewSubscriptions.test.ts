// @vitest-environment happy-dom
// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../logic/app";
import { Event } from "../../../logic/Calendar/Event";
import { Calendar } from "../../../logic/Calendar/Calendar";
import { CalendarRange } from "../../Calendar/CalendarRange";
import DayViewGrid from "../../Calendar/DayView/DayViewGrid.svelte";
import MonthView from "../../Calendar/MonthView/MonthView.svelte";
import ScheduleView from "../../Calendar/ScheduleView/ScheduleView.svelte";
import { ArrayColl } from "svelte-collections";
import { flushSync } from "svelte";
import { createClassComponent } from "svelte/legacy";
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

let view: ReturnType<typeof createClassComponent> | null = null;

afterEach(() => {
  view?.$destroy();
  view = null;
  document.body.innerHTML = "";
});

// Monday, 2026-10-05
const kMonday = new Date(2026, 9, 5);

function at(dayOffset: number, hours = 0): Date {
  return new Date(kMonday.getFullYear(), kMonday.getMonth(), kMonday.getDate() + dayOffset, hours);
}

/** One meeting per day, for 6 weeks, plus an all-day event every Monday */
function newEvents(): ArrayColl<Event> {
  let events = new ArrayColl<Event>();
  for (let day = 0; day < 42; day++) {
    let event = new Event();
    event.title = "Meeting " + day;
    event.startTime = at(day, 10);
    event.endTime = at(day, 11);
    events.add(event);
    if (day % 7 == 0) {
      let allDay = new Event();
      allDay.title = "Trip " + day;
      allDay.allDay = true;
      allDay.startTime = at(day);
      allDay.endTime = at(day + 1);
      events.add(allDay);
    }
  }
  return events;
}

/** How many observers are subscribed to the events */
function subscriptions(events: ArrayColl<Event>): number {
  return events.contents.reduce((sum, event) => sum + event._observers.length, 0);
}

/** Shows another range and goes back, 5 times.
 * September has as many weeks as October. A month with more weeks adds a WeekRow,
 * and when it closes again, svelte-collections can't end the subscriptions of its filter. */
function pageBackAndForth(view: ReturnType<typeof createClassComponent>, type: "week" | "month" | "schedule") {
  for (let i = 0; i < 5; i++) {
    view.$set({ range: new CalendarRange(type, at(type == "month" ? -31 : 7)) });
    flushSync();
    view.$set({ range: new CalendarRange(type, kMonday) });
    flushSync();
  }
}

test("Paging the week view doesn't pile up subscriptions on the events", () => {
  let events = newEvents();
  view = createClassComponent({ component: DayViewGrid, target: document.body, props: {
    range: new CalendarRange("week", kMonday),
    groups: [{ calendar: null, events }],
  } });
  flushSync();
  let shown = subscriptions(events);
  expect(shown).toBeGreaterThan(0);

  pageBackAndForth(view, "week");
  expect(subscriptions(events)).toBe(shown);
});

test("Paging the month view doesn't pile up subscriptions on the events", () => {
  let events = newEvents();
  view = createClassComponent({ component: MonthView, target: document.body, props: {
    range: new CalendarRange("month", kMonday),
    events,
  } });
  flushSync();
  let shown = subscriptions(events);
  expect(shown).toBeGreaterThan(0);

  pageBackAndForth(view, "month");
  expect(subscriptions(events)).toBe(shown);
});

test("Paging the schedule view doesn't pile up subscriptions on the events", () => {
  let events = newEvents();
  let calendar = new Calendar();
  calendar.name = "Test calendar";
  view = createClassComponent({ component: ScheduleView, target: document.body, props: {
    range: new CalendarRange("schedule", kMonday),
    rows: [{ calendar, events }],
  } });
  flushSync();
  let shown = subscriptions(events);
  expect(shown).toBeGreaterThan(0);

  pageBackAndForth(view, "schedule");
  expect(subscriptions(events)).toBe(shown);
});

test("Moving an event into the shown week shows it", () => {
  let events = newEvents();
  view = createClassComponent({ component: DayViewGrid, target: document.body, props: {
    range: new CalendarRange("week", kMonday),
    groups: [{ calendar: null, events }],
  } });
  flushSync();
  let later = events.contents.find(event => event.title == "Meeting 20");
  expect(document.body.textContent).not.toContain("Meeting 20");

  later.startTime = at(2, 14);
  later.endTime = at(2, 15);
  flushSync();
  expect(document.body.textContent).toContain("Meeting 20");
});
