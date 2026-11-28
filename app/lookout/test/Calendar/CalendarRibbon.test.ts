// @vitest-environment happy-dom
// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../logic/app";
import { Calendar } from "../../../logic/Calendar/Calendar";
import type { Event } from "../../../logic/Calendar/Event";
import { Frequency } from "../../../logic/Calendar/RecurrenceRule";
import { DummyCalendarStorage } from "../../../logic/Calendar/SQL/DummyCalendarStorage";
import { getTagByName } from "../../../logic/Abstract/Tag";
import { selectedEvent } from "../../../frontend/Calendar/selected";
import { CalendarCurrentView } from "../../Calendar/selected";
import CalendarRibbon from "../../Calendar/CalendarRibbon.svelte";
import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeAll, expect, test, vi } from "vitest";

let ribbon: Record<string, any> | null = null;

beforeAll(() => {
  (globalThis as any).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(() => {
  unmount(ribbon);
  ribbon = null;
  document.body.innerHTML = "";
  selectedEvent.set(null);
});

function mountRibbon() {
  let target = document.createElement("div");
  document.body.append(target);
  ribbon = mount(CalendarRibbon, { target, props: { view: "week", dayCount: 1, currentView: CalendarCurrentView.Calendar } });
  flushSync();
}

function categorizeButton(): HTMLButtonElement {
  return Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
    .find(button => button.textContent.trim().startsWith("Categorize"));
}

test("Categorize in the ribbon needs a selected event", () => {
  mountRibbon();

  expect(categorizeButton().disabled).toBe(true);
});

test("Categorize in the ribbon tags the whole series of the selected occurrence right away", async () => {
  let calendar = new Calendar();
  calendar.name = "Work";
  let saved: Event[] = [];
  calendar.storage = new DummyCalendarStorage();
  calendar.storage.saveEvent = async event => { saved.push(event); };
  let series = calendar.newEvent();
  series.title = "Standup";
  series.startTime = new Date(2026, 9, 14, 10);
  series.endTime = new Date(2026, 9, 14, 11);
  series.newRecurrenceRule(Frequency.Daily);
  calendar.events.add(series);
  getTagByName("Customer");
  selectedEvent.set(series.instances.get(1));
  mountRibbon();

  categorizeButton().click();
  flushSync();
  Array.from(document.querySelectorAll<HTMLButtonElement>(".lo-menu .lo-menuitem"))
    .find(item => item.textContent.trim() == "Customer").click();

  await vi.waitFor(() => expect(saved).toContain(series));
  expect(series.tags.contents.map(tag => tag.name)).toContain("Customer");
});
