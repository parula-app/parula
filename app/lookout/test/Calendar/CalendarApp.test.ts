// @vitest-environment happy-dom
// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../logic/app";
import { Event } from "../../../logic/Calendar/Event";
import { Calendar } from "../../../logic/Calendar/Calendar";
import { appGlobal } from "../../../logic/app";
import { IncomingInvitation } from "../../../logic/Calendar/Invitation/IncomingInvitation";
import CalendarApp from "../../Calendar/CalendarApp.svelte";
import { CalendarActions } from "../../Calendar/CalendarActions";
import { eventPeek, inlineTitle, selectedSlots, type CalendarViewType } from "../../Calendar/selected";
import { isGoToDateOpen } from "../../Calendar/GoToDateDialog.svelte";
import { selectedCalendar, selectedDate, selectedEvent, shownCalendars, startDate } from "../../../frontend/Calendar/selected";
import { statusBarContent } from "../../MainWindow/StatusBar.svelte";
import { openEvent } from "../../../frontend/Calendar/open";
import { openComposer } from "../../../frontend/Mail/open";
import { getLocalStorage } from "../../../frontend/Util/LocalStorage";
import { getToday } from "../../../logic/util/date";
import { flushSync, mount, unmount } from "svelte";
import { get } from "svelte/store";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";

vi.mock("../../../frontend/Calendar/open", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../frontend/Calendar/open")>(),
  openEvent: vi.fn(),
}));
vi.mock("../../../frontend/Mail/open", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../frontend/Mail/open")>(),
  openComposer: vi.fn(),
}));

beforeAll(() => {
  (globalThis as any).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  HTMLCanvasElement.prototype.getContext = (() => null) as any;
  Element.prototype.scrollTo ??= () => {};
});

const view = getLocalStorage<CalendarViewType>("lookout.calendar.view", "workweek");
const dayCount = getLocalStorage<number>("lookout.calendar.dayCount", 1);

// Wednesday, 2026-10-14
const kWednesday = new Date(2026, 9, 14);

let app: Record<string, any> | null = null;

beforeEach(() => {
  localStorage.clear();
  startDate.set(new Date(kWednesday));
  selectedDate.set(new Date(kWednesday));
  mountApp();
});

function mountApp() {
  let target = document.createElement("div");
  document.body.append(target);
  app = mount(CalendarApp, { target });
  flushSync();
}

afterEach(() => {
  unmount(app);
  app = null;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.mocked(openEvent).mockClear();
  vi.mocked(openComposer).mockClear();
  selectedEvent.set(null);
  selectedSlots.set(null);
  inlineTitle.set(null);
  eventPeek.set(null);
  isGoToDateOpen.set(false);
});

/** Presses the key on the calendar page and returns whether the calendar handled it */
function handled(key: string, init: KeyboardEventInit = {}, target: HTMLElement = document.body): boolean {
  let code = /^\d$/.test(key) ? "Digit" + key : /^[a-z]$/i.test(key) ? "Key" + key.toUpperCase() : key;
  let event = new KeyboardEvent("keydown", { key, code, cancelable: true, bubbles: true, ...init });
  target.dispatchEvent(event);
  flushSync();
  return event.defaultPrevented;
}

function onMac() {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)");
}

function day(date: Date): string {
  return date.toDateString();
}

test("New appointment and meeting", () => {
  let newEvent = vi.spyOn(CalendarActions, "newEventAtSelection").mockImplementation(() => {});
  expect(handled("n", { ctrlKey: true })).toBe(true);
  expect(newEvent).toHaveBeenLastCalledWith(null);
  expect(handled("A", { ctrlKey: true, shiftKey: true })).toBe(true);
  expect(newEvent).toHaveBeenLastCalledWith(null);
  expect(handled("Q", { ctrlKey: true, shiftKey: true })).toBe(true);
  expect(newEvent).toHaveBeenLastCalledWith(null, "meeting");
  expect(handled("n", { metaKey: true })).toBe(true);
  expect(newEvent).toHaveBeenCalledTimes(4);
});

test("Views", () => {
  expect(handled("1", { ctrlKey: true, altKey: true })).toBe(true);
  expect(view.value).toBe("day");
  expect(handled("2", { ctrlKey: true, altKey: true })).toBe(true);
  expect(view.value).toBe("workweek");
  expect(handled("3", { ctrlKey: true, altKey: true })).toBe(true);
  expect(view.value).toBe("week");
  expect(handled("4", { ctrlKey: true, altKey: true })).toBe(true);
  expect(view.value).toBe("month");
  expect(handled("5", { ctrlKey: true, altKey: true })).toBe(true);
  expect(view.value).toBe("schedule");
  expect(handled("6", { ctrlKey: true, altKey: true })).toBe(false);
  expect(handled("-", { code: "Minus", altKey: true })).toBe(true);
  expect(view.value).toBe("week");
  expect(handled("=", { code: "Equal", altKey: true })).toBe(true);
  expect(view.value).toBe("month");
});

test("Alt+digit shows that many days, Alt+0 ten days", () => {
  expect(handled("3", { altKey: true })).toBe(true);
  expect(view.value).toBe("day");
  expect(dayCount.value).toBe(3);
  expect(handled("0", { altKey: true })).toBe(true);
  expect(dayCount.value).toBe(10);
  // The key code counts, also when the layout gives another character
  expect(handled("¡", { code: "Digit1", altKey: true })).toBe(true);
  expect(dayCount.value).toBe(1);
});

test("Navigation", () => {
  expect(handled("g", { ctrlKey: true })).toBe(true);
  expect(get(isGoToDateOpen)).toBe(true);
  isGoToDateOpen.set(false);

  expect(handled("ArrowRight", { ctrlKey: true })).toBe(true);
  expect(day(get(startDate))).toBe(day(new Date(2026, 9, 15)));
  expect(handled("ArrowLeft", { ctrlKey: true })).toBe(true);
  expect(day(get(startDate))).toBe(day(kWednesday));
  expect(handled("ArrowDown", { altKey: true })).toBe(true);
  expect(day(get(startDate))).toBe(day(new Date(2026, 9, 21)));
  expect(handled("ArrowUp", { altKey: true })).toBe(true);
  expect(day(get(startDate))).toBe(day(kWednesday));
  expect(handled("PageDown", { altKey: true })).toBe(true);
  expect(day(get(startDate))).toBe(day(new Date(2026, 10, 1)));
  expect(handled("PageUp", { altKey: true })).toBe(true);
  expect(day(get(startDate))).toBe(day(new Date(2026, 9, 1)));

  let before = get(startDate);
  expect(handled("ArrowRight", { ctrlKey: true, altKey: true })).toBe(true);
  expect(get(startDate).getTime()).toBeGreaterThan(before.getTime());

  expect(handled("Y", { code: "KeyY", altKey: true, shiftKey: true })).toBe(true);
  expect(day(get(startDate))).toBe(day(getToday()));
  expect(day(get(selectedDate))).toBe(day(getToday()));
});

test("Alt+Home and Alt+End go to the start and end of the week", () => {
  selectedDate.set(new Date(kWednesday));
  expect(handled("End", { altKey: true })).toBe(true);
  let end = get(selectedDate);
  expect(handled("Home", { altKey: true })).toBe(true);
  let start = get(selectedDate);
  expect(Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000))).toBe(6);
  expect(start.getTime()).toBeLessThanOrEqual(kWednesday.getTime());
  expect(end.getTime()).toBeGreaterThanOrEqual(kWednesday.getTime());
  expect(handled("Home")).toBe(false);
});

test("Item commands", async () => {
  let event = new Event();
  event.title = "Meeting";
  event.startTime = new Date(2026, 9, 14, 10);
  event.endTime = new Date(2026, 9, 14, 11);
  selectedEvent.set(event);

  expect(handled("Enter")).toBe(true);
  expect(openEvent).toHaveBeenCalledWith(event, true);
  let button = document.createElement("button");
  document.body.append(button);
  expect(handled("Enter", {}, button)).toBe(false);
  expect(openEvent).toHaveBeenCalledTimes(1);

  let deleteDefault = vi.spyOn(CalendarActions, "deleteDefault").mockImplementation(async () => {});
  expect(handled("Delete")).toBe(true);
  expect(deleteDefault).toHaveBeenCalledWith(event);

  let forwardMail = {};
  let forward = vi.spyOn(IncomingInvitation, "forwardEventByMail").mockResolvedValue(forwardMail as any);
  expect(handled("f", { ctrlKey: true })).toBe(true);
  expect(forward).toHaveBeenCalledWith(event);
  await vi.waitFor(() => expect(openComposer).toHaveBeenCalledWith(forwardMail));

  selectedSlots.set({ start: new Date(2026, 9, 14, 9), end: new Date(2026, 9, 14, 10), allDay: false, calendar: null });
  expect(handled("Escape")).toBe(true);
  expect(get(selectedSlots)).toBe(null);
  expect(get(eventPeek)).toBe(null);
  expect(get(inlineTitle)).toBe(null);
});

test("Typing on selected time slots starts a new event's title", () => {
  expect(handled("M", { shiftKey: true })).toBe(false);
  selectedSlots.set({ start: new Date(2026, 9, 14, 9), end: new Date(2026, 9, 14, 10), allDay: false, calendar: null });
  expect(handled(" ")).toBe(false);
  expect(handled("M", { shiftKey: true })).toBe(true);
  expect(get(inlineTitle)).toBe("M");
});

test("Plain letters and other keys do nothing", () => {
  expect(handled("n")).toBe(false);
  expect(handled("Enter", { shiftKey: true })).toBe(false);
  expect(handled("x", { ctrlKey: true })).toBe(false);
  expect(handled("ArrowDown")).toBe(false);
});

test("Keys in text fields and dialogs stay there", () => {
  let input = document.createElement("input");
  document.querySelector(".calendar-page").append(input);
  expect(handled("ArrowRight", { ctrlKey: true }, input)).toBe(false);
  expect(handled("Delete", {}, input)).toBe(false);
  let dialog = document.createElement("dialog");
  let button = document.createElement("button");
  dialog.append(button);
  document.querySelector(".calendar-page").append(dialog);
  expect(handled("1", { ctrlKey: true, altKey: true }, button)).toBe(false);
  expect(day(get(startDate))).toBe(day(kWednesday));
});

test("macOS: no Option+character keys, because they type characters there", () => {
  onMac();
  expect(handled("1", { altKey: true })).toBe(false);
  expect(handled("-", { code: "Minus", altKey: true })).toBe(false);
  expect(handled("=", { code: "Equal", altKey: true })).toBe(false);
  expect(handled("Y", { code: "KeyY", altKey: true, shiftKey: true })).toBe(false);
  // Option+arrows and Ctrl+Option+digits type nothing
  expect(handled("ArrowDown", { altKey: true })).toBe(true);
  expect(handled("End", { altKey: true })).toBe(true);
  expect(handled("1", { ctrlKey: true, altKey: true })).toBe(true);
  expect(view.value).toBe("day");
});

function newCalendar(name: string, eventDays: number[]): Calendar {
  let calendar = new Calendar();
  calendar.id = name;
  calendar.name = name;
  for (let dayOfMonth of eventDays) {
    let event = new Event();
    event.title = name + " " + dayOfMonth;
    event.startTime = new Date(2026, 9, dayOfMonth, 10);
    event.endTime = new Date(2026, 9, dayOfMonth, 11);
    event.calendar = calendar;
    calendar.events.add(event);
  }
  return calendar;
}

/** How many observers are subscribed to the events */
function subscriptions(calendar: Calendar): number {
  return calendar.events.contents.reduce((sum, event) => sum + event._observers.length, 0);
}

test("Showing and hiding another calendar doesn't pile up subscriptions on the events", () => {
  let work = newCalendar("Work", [12, 14, 20, 28]);
  let holidays = newCalendar("Holidays", [13]);
  appGlobal.calendars.addAll([work, holidays]);
  try {
    flushSync();
    let shown = subscriptions(work);
    expect(shown).toBeGreaterThan(0);
    for (let i = 0; i < 3; i++) {
      shownCalendars.show(holidays, false);
      flushSync();
      shownCalendars.show(holidays, true);
      flushSync();
    }
    expect(subscriptions(work)).toBe(shown);
  } finally {
    shownCalendars.show(holidays, true);
    appGlobal.calendars.removeAll([work, holidays]);
  }
});

for (let shownView of ["workweek", "month", "schedule"] as CalendarViewType[]) {
  test(`Showing and hiding another calendar in the split ${shownView} view doesn't pile up subscriptions on the events`, () => {
    unmount(app);
    getLocalStorage<boolean>("lookout.calendar.splitView", false).value = true;
    view.value = shownView;
    mountApp();
    let work = newCalendar("Work", [12, 14, 20, 28]);
    let holidays = newCalendar("Holidays", [13]);
    let team = newCalendar("Team", [15]);
    appGlobal.calendars.addAll([work, holidays, team]);
    try {
      flushSync();
      let shown = subscriptions(work) + subscriptions(team);
      expect(shown).toBeGreaterThan(0);
      for (let i = 0; i < 3; i++) {
        shownCalendars.show(holidays, false);
        flushSync();
        shownCalendars.show(holidays, true);
        flushSync();
      }
      expect(subscriptions(work) + subscriptions(team)).toBe(shown);
    } finally {
      shownCalendars.show(holidays, true);
      appGlobal.calendars.removeAll([work, holidays, team]);
    }
  });
}

test("The status bar counts the events in the shown days", () => {
  let work = newCalendar("Work", [12, 14, 20]);
  appGlobal.calendars.add(work);
  try {
    flushSync();
    expect(get(statusBarContent).left[0].label).toBe("Items: 2");
    let event = new Event();
    event.startTime = new Date(2026, 9, 15, 9);
    event.endTime = new Date(2026, 9, 15, 10);
    event.calendar = work;
    work.events.add(event);
    flushSync();
    expect(get(statusBarContent).left[0].label).toBe("Items: 3");
    // The next week
    expect(handled("ArrowDown", { altKey: true })).toBe(true);
    expect(get(statusBarContent).left[0].label).toBe("Items: 1");
  } finally {
    appGlobal.calendars.remove(work);
  }
});

test("The + on a day asks for the calendar when several are shown, and the new appointment goes into the chosen one", async () => {
  let work = newCalendar("Work", []);
  let family = newCalendar("Family", []);
  appGlobal.calendars.addAll([work, family]);
  try {
    flushSync();
    document.querySelector<HTMLButtonElement>(".day-header .add-button").click();
    flushSync();
    expect(openEvent).not.toHaveBeenCalled();
    let items = Array.from(document.querySelectorAll<HTMLButtonElement>(".lo-menu .lo-menuitem"));
    expect(items.map(item => item.textContent.trim())).toEqual(expect.arrayContaining(["Work", "Family"]));
    items.find(item => item.textContent.trim() == "Family").click();
    await vi.waitFor(() => expect(openEvent).toHaveBeenCalledTimes(1));
    let event = vi.mocked(openEvent).mock.calls[0][0];
    expect(event.calendar).toBe(family);
    expect(get(selectedCalendar)).toBe(family);

    vi.mocked(openEvent).mockClear();
    shownCalendars.show(work, false);
    flushSync();
    document.querySelector<HTMLButtonElement>(".day-header .add-button").click();
    flushSync();
    expect(document.querySelector(".lo-menu")).toBe(null);
    expect(openEvent).toHaveBeenCalledTimes(1);
    expect(vi.mocked(openEvent).mock.calls[0][0].calendar).toBe(family);
  } finally {
    shownCalendars.show(work, true);
    appGlobal.calendars.removeAll([work, family]);
  }
});
