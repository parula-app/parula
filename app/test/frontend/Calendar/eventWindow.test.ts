// @vitest-environment happy-dom
// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../logic/app";
import { Calendar } from "../../../logic/Calendar/Calendar";
import type { Event } from "../../../logic/Calendar/Event";
import { DummyCalendarStorage } from "../../../logic/Calendar/SQL/DummyCalendarStorage";
import { CalendarEventMustangApp, calendarMustangApp } from "../../../frontend/Calendar/CalendarMustangApp";
import { selectedEvent } from "../../../frontend/Calendar/selected";
import { selectedApp } from "../../../frontend/AppsBar/selectedApp";
import { AppWindow } from "../../../frontend/MainWindow/AppWindow";
import ShowEvent from "../../../frontend/Calendar/DisplayEvent/ShowEvent.svelte";
import EventWindow from "../../../frontend/Calendar/DisplayEvent/EventWindow.svelte";
import { flushSync, mount, unmount } from "svelte";
import { get } from "svelte/store";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";

beforeAll(() => {
  (globalThis as any).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

beforeEach(() => {
  appGlobal.remoteApp = {} as any;
  appGlobal.calendars.clear();
  calendarMustangApp.subApps.clear();
  selectedEvent.set(null);
  selectedApp.set(null);
});

function newTestEvent(): Event {
  let calendar = new Calendar();
  calendar.name = "Test calendar";
  calendar.storage = new DummyCalendarStorage();
  appGlobal.calendars.add(calendar);
  let event = calendar.newEvent();
  event.title = "Lunch";
  event.startTime = new Date(2026, 8, 4, 10, 0);
  event.endTime = new Date(2026, 8, 4, 11, 0);
  return event;
}

// Stands in for the event's own window
class EventsOwnWindow extends AppWindow {
  constructor() {
    super(window, "event", AppWindow.main);
  }
}

let dialog: Record<string, any> | null = null;

/** happy-dom has only one window, so the event's window shares the test's window and document */
function mountIn(appWindow: AppWindow, component: any, event: Event) {
  dialog = mount(component, { target: document.body, props: { event }, context: new Map([["appWindow", appWindow]]) });
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
  vi.restoreAllMocks();
});

test("Open in a separate window moves the event editor from the sidebar into its own window, with the changes", async () => {
  let event = newTestEvent();
  selectedEvent.set(event);
  event.startEditing();
  mountIn(AppWindow.main, ShowEvent, event);
  event.title = "Lunch with Anna";
  flushSync();
  let open = vi.spyOn(AppWindow.prototype, "open").mockResolvedValue(null);

  button("Open in a separate window").click();

  await vi.waitFor(() => expect(get(selectedEvent)).toBeNull());
  expect(open).toHaveBeenCalledWith(EventWindow, { event }, 1000);
  expect(event.hasChanged()).toBe(true);
});

test("In its own window, the editor has no buttons that move it, and Save closes the window", async () => {
  let event = newTestEvent();
  event.startEditing();
  // The main window shows another event in the full window
  selectedApp.set(new CalendarEventMustangApp());
  let ownWindow = new EventsOwnWindow();
  let close = vi.spyOn(ownWindow, "close").mockReturnValue();
  mountIn(ownWindow, EventWindow, event);
  expect(button("Open in a separate window")).toBeNull();
  expect(button("Shrink dialog to sidebar")).toBeNull();
  event.title = "Lunch with Anna";
  flushSync();

  button("Save").click();

  await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(event.unedited).toBeNull();
  expect(event.calendar.events.contains(event)).toBe(true);
});

test("In its own window, Edit edits the event there, and Cancel closes the window", () => {
  let event = newTestEvent();
  let ownWindow = new EventsOwnWindow();
  let close = vi.spyOn(ownWindow, "close").mockReturnValue();
  mountIn(ownWindow, EventWindow, event);
  expect(button("Expand dialog size to full window")).toBeNull();

  button("Edit").click();
  flushSync();
  expect(event.unedited).not.toBeNull();
  expect(calendarMustangApp.subApps.length).toBe(0);

  button("Cancel").click();
  flushSync();
  expect(close).toHaveBeenCalledOnce();
  expect(event.unedited).toBeNull();
});
