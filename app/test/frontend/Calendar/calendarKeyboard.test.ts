// @vitest-environment happy-dom
// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../logic/app";
import { onKeyOnCalendar } from "../../../frontend/Calendar/CalendarKeyboard";
import { selectedDate, selectedEvent, startDate, type DateInterval } from "../../../frontend/Calendar/selected";
import { createNewEvent } from "../../../frontend/Calendar/event";
import { openEvent } from "../../../frontend/Calendar/open";
import { getLocalStorage } from "../../../frontend/Util/LocalStorage";
import { get } from "svelte/store";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

vi.mock("../../../frontend/Calendar/event", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../frontend/Calendar/event")>(),
  createNewEvent: vi.fn(),
}));
vi.mock("../../../frontend/Calendar/open", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../frontend/Calendar/open")>(),
  openEvent: vi.fn(),
}));

function press(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  return new KeyboardEvent("keydown", { key, cancelable: true, bubbles: true, ...init });
}

/** Presses the key and returns whether the calendar handled it */
async function handled(key: string, init: KeyboardEventInit = {}): Promise<boolean> {
  let event = press(key, init);
  await onKeyOnCalendar(event);
  return event.defaultPrevented;
}

const view = getLocalStorage<DateInterval>("calendar.view", 2);

function showing(viewInterval: DateInterval, start: Date, selected = start) {
  view.value = viewInterval;
  startDate.set(new Date(start));
  selectedDate.set(new Date(selected));
}

function day(year: number, month: number, date: number): string {
  return new Date(year, month - 1, date).toDateString();
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(createNewEvent).mockClear();
  vi.mocked(openEvent).mockClear();
  selectedEvent.set(null);
});

test("Ctrl+Alt+1..4 and Alt+- / Alt+= switch the view", async () => {
  expect(await handled("1", { code: "Digit1", ctrlKey: true, altKey: true })).toBe(true);
  expect(view.value).toBe(1);
  expect(await handled("²", { code: "Digit2", ctrlKey: true, altKey: true })).toBe(true);
  expect(view.value).toBe(5);
  expect(await handled("3", { code: "Digit3", ctrlKey: true, altKey: true })).toBe(true);
  expect(view.value).toBe(7);
  expect(await handled("4", { code: "Digit4", ctrlKey: true, altKey: true })).toBe(true);
  expect(view.value).toBe(31);
  expect(await handled("5", { code: "Digit5", ctrlKey: true, altKey: true })).toBe(false);
  expect(await handled("-", { code: "Minus", altKey: true })).toBe(true);
  expect(view.value).toBe(7);
  expect(await handled("=", { code: "Equal", altKey: true })).toBe(true);
  expect(view.value).toBe(31);
  // Option+- types a dash on macOS
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)");
  expect(await handled("–", { code: "Minus", altKey: true })).toBe(false);
  expect(view.value).toBe(31);
});

test("Day view: next and previous day, week, month, period", async () => {
  showing(1, new Date(2026, 9, 16));
  expect(await handled("ArrowRight", { ctrlKey: true })).toBe(true);
  expect(get(startDate).toDateString()).toBe(day(2026, 10, 17));
  expect(get(selectedDate).toDateString()).toBe(day(2026, 10, 17));
  expect(await handled("ArrowLeft", { ctrlKey: true })).toBe(true);
  expect(get(startDate).toDateString()).toBe(day(2026, 10, 16));
  expect(await handled("ArrowUp", { altKey: true })).toBe(true);
  expect(get(startDate).toDateString()).toBe(day(2026, 10, 9));
  expect(await handled("ArrowDown", { altKey: true })).toBe(true);
  expect(get(startDate).toDateString()).toBe(day(2026, 10, 16));
  expect(await handled("ArrowRight", { ctrlKey: true, altKey: true })).toBe(true);
  expect(get(startDate).toDateString()).toBe(day(2026, 10, 17));
  expect(await handled("PageDown", { altKey: true })).toBe(true);
  expect(get(startDate).toDateString()).toBe(day(2026, 11, 17));
  expect(await handled("PageUp", { altKey: true })).toBe(true);
  expect(get(startDate).toDateString()).toBe(day(2026, 10, 17));
  expect(await handled("ArrowDown")).toBe(false);
});

test("Next month keeps the day, as far as the month has it", async () => {
  showing(1, new Date(2026, 0, 31));
  expect(await handled("PageDown", { altKey: true })).toBe(true);
  expect(get(startDate).toDateString()).toBe(day(2026, 2, 28));
});

test("Week view: next period is the next week, from the selected day", async () => {
  // Wednesday selected in the week of Monday 12 Oct 2026
  showing(7, new Date(2026, 9, 12), new Date(2026, 9, 14));
  expect(await handled("ArrowRight", { ctrlKey: true, altKey: true })).toBe(true);
  expect(get(selectedDate).toDateString()).toBe(day(2026, 10, 21));
  expect(await handled("Home", { altKey: true })).toBe(true);
  expect(get(selectedDate).toDateString()).toBe(day(2026, 10, 19));
  expect(await handled("End", { altKey: true })).toBe(true);
  expect(get(selectedDate).toDateString()).toBe(day(2026, 10, 25));
});

test("Week view: a selected day outside the shown week is ignored", async () => {
  showing(7, new Date(2026, 9, 12), new Date(2026, 8, 1));
  expect(await handled("ArrowRight", { ctrlKey: true })).toBe(true);
  expect(get(selectedDate).toDateString()).toBe(day(2026, 10, 13));
});

test("Month view: next period is the next month, also when the first row starts in the previous month", async () => {
  // November 2026 shown: its first row starts on Monday 26 Oct
  showing(31, new Date(2026, 9, 26), new Date(2026, 9, 26));
  expect(await handled("ArrowRight", { ctrlKey: true, altKey: true })).toBe(true);
  expect(get(startDate).getMonth()).toBe(11);
  expect(get(startDate).getFullYear()).toBe(2026);
});

test("Alt+Shift+Y goes to today", async () => {
  showing(1, new Date(2020, 0, 1));
  expect(await handled("Y", { code: "KeyY", altKey: true, shiftKey: true })).toBe(true);
  expect(get(startDate).toDateString()).toBe(new Date().toDateString());
});

test("Ctrl+N creates a new event, Enter opens the selected event", async () => {
  expect(await handled("n", { ctrlKey: true })).toBe(true);
  expect(createNewEvent).toHaveBeenCalledTimes(1);
  expect(await handled("Enter")).toBe(false);
  let calendarEvent = { title: "Meeting" } as any;
  selectedEvent.set(calendarEvent);
  expect(await handled("Enter", { shiftKey: true })).toBe(false);
  expect(await handled("Enter")).toBe(true);
  expect(openEvent).toHaveBeenCalledWith(calendarEvent, true);
});

test("Ctrl+E goes to the search field", async () => {
  let header = document.createElement("div");
  header.className = "window-header";
  header.innerHTML = `<div class="search-box"><input type="search"></div>`;
  document.body.append(header);
  expect(await handled("e", { ctrlKey: true })).toBe(true);
  expect(document.activeElement).toBe(header.querySelector("input"));
  header.remove();
});

test("Enter on a button stays the button's", async () => {
  selectedEvent.set({ title: "Meeting" } as any);
  let button = document.createElement("button");
  document.body.append(button);
  let event = press("Enter");
  button.addEventListener("keydown", keyEvent => onKeyOnCalendar(keyEvent));
  button.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
  expect(openEvent).not.toHaveBeenCalled();
  button.remove();
});

test("Keys don't act in text fields", async () => {
  showing(1, new Date(2026, 9, 16));
  let input = document.createElement("input");
  document.body.append(input);
  let event = press("ArrowRight", { ctrlKey: true });
  input.addEventListener("keydown", keyEvent => onKeyOnCalendar(keyEvent));
  input.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
  expect(get(startDate).toDateString()).toBe(day(2026, 10, 16));
  input.remove();
});
