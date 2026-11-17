// @vitest-environment happy-dom
// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../logic/app";
import { Calendar } from "../../../logic/Calendar/Calendar";
import type { Event } from "../../../logic/Calendar/Event";
import { CalendarEventMustangApp, calendarMustangApp } from "../../../frontend/Calendar/CalendarMustangApp";
import { selectedEvent } from "../../../frontend/Calendar/selected";
import { selectedApp } from "../../../frontend/AppsBar/selectedApp";
import ShowEvent from "../../../frontend/Calendar/DisplayEvent/ShowEvent.svelte";
import { flushSync, mount, unmount } from "svelte";
import { get } from "svelte/store";
import { afterEach, beforeAll, beforeEach, expect, test } from "vitest";

beforeAll(() => {
  (globalThis as any).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

beforeEach(() => {
  appGlobal.calendars.clear();
  calendarMustangApp.subApps.clear();
  selectedEvent.set(null);
  selectedApp.set(null);
});

function newTestEvent(): Event {
  let calendar = new Calendar();
  calendar.name = "Test calendar";
  appGlobal.calendars.add(calendar);
  let event = calendar.newEvent();
  event.startTime = new Date(2026, 8, 4, 10, 0);
  event.endTime = new Date(2026, 8, 4, 11, 0);
  return event;
}

/** Opens the event in the full window, as `openEvent()` does for a new event */
function openInFullWindow(event: Event) {
  selectedEvent.set(event);
  calendarMustangApp.showEvent(event);
  selectedApp.set(calendarMustangApp.subApps.first as CalendarEventMustangApp);
  event.startEditing();
}

let dialog: Record<string, any> | null = null;

function showEvent(event: Event) {
  dialog = mount(ShowEvent, { target: document.body, props: { event } });
  flushSync();
}

function button(label: string): HTMLButtonElement | null {
  return document.body.querySelector(`button[title="${label}"]`);
}

afterEach(() => {
  if (dialog) {
    unmount(dialog);
    dialog = null;
  }
  document.body.innerHTML = "";
});

// #1429: [Shrink] also ended the editing session, so `hasChanged()` had
// nothing left to compare against and the dialog offered [Close], not [Save].
test("Shrinking the dialog keeps the unsaved changes savable - #1429", () => {
  let event = newTestEvent();
  openInFullWindow(event);
  showEvent(event);

  event.title = "Lunch";
  flushSync();
  expect(button("Save")).not.toBeNull();

  button("Shrink dialog to sidebar").click();
  flushSync();

  expect(event.unedited).not.toBeNull();
  expect(event.hasChanged()).toBe(true);
  expect(event.title).toBe("Lunch");
  // Still the editor, not the read-only display
  expect(button("Save")).not.toBeNull();
});

test("Shrinking removes the full window, so another event can be shown - #1429", () => {
  let event = newTestEvent();
  openInFullWindow(event);
  showEvent(event);
  event.title = "Lunch";
  flushSync();
  expect(calendarMustangApp.subApps.length).toBe(1);

  button("Shrink dialog to sidebar").click();
  flushSync();

  expect(calendarMustangApp.subApps.length).toBe(0);
  expect(get(selectedEvent)).toBe(event);
});

// Being done with the event must still end the session, or [Edit] would
// resume a stale draft.
test("Reverting the dialog ends the editing session", () => {
  let event = newTestEvent();
  openInFullWindow(event);
  showEvent(event);
  event.title = "Lunch";
  flushSync();

  button("Revert").click();
  flushSync();

  expect(event.unedited).toBeNull();
  expect(event.title).toBeFalsy();
});
