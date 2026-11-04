// @vitest-environment happy-dom
// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../logic/app";
import { Calendar } from "../../../logic/Calendar/Calendar";
import { CalendarEventMustangApp, calendarMustangApp } from "../../../frontend/Calendar/CalendarMustangApp";
import { mailMustangApp, WriteMailMustangApp } from "../../../frontend/Mail/MailMustangApp";
import { goBack, mustangApps, openApp, selectedApp } from "../../../frontend/AppsBar/selectedApp";
import { get } from "svelte/store";
import { beforeEach, expect, test, vi } from "vitest";

beforeEach(() => {
  mustangApps.replaceAll([mailMustangApp, calendarMustangApp]);
  calendarMustangApp.subApps.clear();
  mailMustangApp.subApps.clear();
});

async function waitForApp(app: unknown) {
  for (let i = 0; i < 50 && get(selectedApp) != app; i++) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

test("Closing the composer goes back to the event window, which then can close itself", async () => {
  let calendar = new Calendar();
  appGlobal.calendars.add(calendar);
  let event = calendar.newEvent();
  event.title = "Planning";
  openApp(calendarMustangApp, {});
  calendarMustangApp.showEvent(event);
  let eventWindow = get(selectedApp);
  expect(eventWindow).toBeInstanceOf(CalendarEventMustangApp);

  // What `openComposer()` and the composer's `onClose()` do
  let composer = new WriteMailMustangApp();
  mailMustangApp.subApps.add(composer);
  openApp(composer, composer.windowParams);
  expect(get(selectedApp)).toBe(composer);
  mailMustangApp.subApps.remove(composer);
  goBack();
  await waitForApp(eventWindow);
  expect(get(selectedApp)).toBe(eventWindow);

  // What the event window's close button does
  calendarMustangApp.closeEvent(event);
  goBack();
  await waitForApp(calendarMustangApp);
  expect(get(selectedApp)).toBe(calendarMustangApp);
});

test("Starts when the page reloads with params in the history entry", async () => {
  window.history.replaceState({ usr: { id: 1 }, key: "reload", idx: 0 }, "", "#/calendar");
  vi.resetModules();
  await expect(import("../../../frontend/AppsBar/selectedApp")).resolves.toHaveProperty("selectedApp");
});
