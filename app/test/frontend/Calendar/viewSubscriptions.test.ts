// @vitest-environment happy-dom
// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../logic/app";
import { Event } from "../../../logic/Calendar/Event";
import { globalSearchTerm } from "../../../frontend/AppsBar/selectedApp";
import { getWeekStart } from "../../../logic/util/date";
import DayViewGrid from "../../../frontend/Calendar/DayView/DayViewGrid.svelte";
import MonthView from "../../../frontend/Calendar/MonthView/MonthView.svelte";
import ListViewWithSearch from "../../../frontend/Calendar/ListView/ListViewWithSearch.svelte";
import { ArrayColl } from "svelte-collections";
import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeAll, expect, test, vi } from "vitest";

beforeAll(() => {
  (globalThis as any).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

let view: Record<string, any> | null = null;

afterEach(() => {
  if (view) {
    unmount(view);
    view = null;
  }
  globalSearchTerm.set(null);
  document.body.innerHTML = "";
});

/** Monday of next week, so that the list view shows the events, too */
function nextMonday(): Date {
  let monday = getWeekStart(new Date());
  monday.setDate(monday.getDate() + 7);
  return monday;
}

/** One meeting per day, for 6 weeks, plus an all-day event every Monday */
function newEvents(): ArrayColl<Event> {
  let events = new ArrayColl<Event>();
  let monday = nextMonday();
  for (let day = 0; day < 42; day++) {
    let event = new Event();
    event.title = "Meeting " + day;
    event.startTime = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + day, 10, 0);
    event.endTime = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + day, 11, 0);
    events.add(event);
    if (day % 7 == 0) {
      let allDay = new Event();
      allDay.title = "Trip " + day;
      allDay.allDay = true;
      allDay.startTime = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + day);
      allDay.endTime = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + day + 1);
      events.add(allDay);
    }
  }
  return events;
}

/** How many observers are subscribed to the events */
function subscriptions(events: ArrayColl<Event>): number {
  return events.contents.reduce((sum, event) => sum + event._observers.length, 0);
}

function swipe(selector: string, direction: string) {
  document.querySelector(selector).dispatchEvent(new CustomEvent(direction));
  flushSync();
}

test("Paging the week view doesn't pile up subscriptions on the events", () => {
  let events = newEvents();
  view = mount(DayViewGrid, { target: document.body, props: { start: nextMonday(), events, showDays: 7 } });
  flushSync();
  let shown = subscriptions(events);
  expect(shown).toBeGreaterThan(0);

  for (let i = 0; i < 5; i++) {
    swipe(".week", "swipeleft");
    swipe(".week", "swiperight");
  }
  expect(subscriptions(events)).toBe(shown);
});

test("Paging the month view doesn't pile up subscriptions on the events", () => {
  let events = newEvents();
  view = mount(MonthView, { target: document.body, props: { start: nextMonday(), events, showDays: 28 } });
  flushSync();
  let shown = subscriptions(events);
  expect(shown).toBeGreaterThan(0);

  for (let i = 0; i < 5; i++) {
    swipe(".month", "swipeleft");
    swipe(".month", "swiperight");
  }
  expect(subscriptions(events)).toBe(shown);
});

test("Typing a search term doesn't pile up subscriptions on the events", () => {
  let events = newEvents();
  view = mount(ListViewWithSearch, { target: document.body, props: { events } });
  flushSync();
  let shown = subscriptions(events);

  for (let term of ["m", "me", "mee", "meet", "mee", "me", "m"]) {
    globalSearchTerm.set(term);
    flushSync();
  }
  expect(document.querySelector(".result-count").textContent).toContain("42");
  globalSearchTerm.set(null);
  flushSync();
  expect(subscriptions(events)).toBe(shown);
});

test("A changed event is filtered alone, not together with all others", () => {
  let events = newEvents();
  view = mount(ListViewWithSearch, { target: document.body, props: { events } });
  globalSearchTerm.set("meeting");
  flushSync();
  expect(document.querySelector(".result-count").textContent).toContain("42");

  let matchesSearch = vi.spyOn(Event.prototype, "matchesSearch");
  let event = events.contents.find(event => event.title == "Meeting 20");
  event.title = "Lunch";
  flushSync();
  expect(matchesSearch).toHaveBeenCalledTimes(1);
  matchesSearch.mockRestore();
});

test("Moving an event into the shown week shows it", () => {
  let events = newEvents();
  view = mount(DayViewGrid, { target: document.body, props: { start: nextMonday(), events, showDays: 7 } });
  flushSync();
  let later = events.contents.find(event => event.title == "Meeting 20");
  expect(document.body.textContent).not.toContain("Meeting 20");

  let monday = nextMonday();
  later.startTime = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 2, 14, 0);
  later.endTime = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 2, 15, 0);
  flushSync();
  expect(document.body.textContent).toContain("Meeting 20");
});

test("A new search term after clearing the search finds only its own matches", () => {
  let events = newEvents();
  view = mount(ListViewWithSearch, { target: document.body, props: { events } });
  globalSearchTerm.set("trip");
  flushSync();
  expect(document.querySelector(".result-count").textContent).toMatch(/\b6\b/);

  globalSearchTerm.set(null);
  flushSync();
  globalSearchTerm.set("meeting 4");
  flushSync();
  // Meeting 4, 40 and 41
  expect(document.querySelector(".result-count").textContent).toMatch(/\b3\b/);
});

test("An event added or removed during a search appears in or disappears from the results", () => {
  let events = newEvents();
  view = mount(ListViewWithSearch, { target: document.body, props: { events } });
  globalSearchTerm.set("lunch");
  flushSync();
  expect(document.body.textContent).not.toContain("Lunch with Anna");

  let monday = nextMonday();
  let lunch = new Event();
  lunch.title = "Lunch with Anna";
  lunch.startTime = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 3, 12, 0);
  lunch.endTime = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 3, 13, 0);
  events.add(lunch);
  flushSync();
  expect(document.body.textContent).toContain("Lunch with Anna");

  events.remove(lunch);
  flushSync();
  expect(document.body.textContent).not.toContain("Lunch with Anna");
});
