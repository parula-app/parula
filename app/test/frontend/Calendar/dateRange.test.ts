// @vitest-environment happy-dom
// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../logic/app";
import DateRange from "../../../frontend/Calendar/DateRange.svelte";
import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeAll, expect, test } from "vitest";

beforeAll(() => {
  (globalThis as any).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

let dateRange: Record<string, any> | null = null;

afterEach(() => {
  unmount(dateRange);
  dateRange = null;
  document.body.innerHTML = "";
});

function header(): string {
  return document.querySelector(".date-range").textContent;
}

function isPickerOpen(): boolean {
  return !!document.querySelector(".month-year-picker");
}

function click(button: Element) {
  (button as HTMLElement).click();
  flushSync();
}

function year(year: number): Element {
  return [...document.querySelectorAll("button.year")].find(button => button.textContent.includes(String(year)));
}

test("Week view: A year keeps the dropdown open, a month closes it, and the header shows the chosen month", () => {
  // Sunday, Nov 1. Its week is mostly in October, so the header shows October.
  dateRange = mount(DateRange, { target: document.body, props: { date: new Date(2026, 10, 1), dateInterval: 7, showDays: 7 } });
  flushSync();
  expect(header()).toContain("October");
  expect(header()).toContain("2026");

  click(document.querySelector(".date-range"));
  expect(isPickerOpen()).toBe(true);

  // Oct 1, 2027 is a Friday, so its week is mostly in September
  click(year(2027));
  expect(header()).toContain("October");
  expect(header()).toContain("2027");
  expect(isPickerOpen()).toBe(true);

  let march = document.querySelectorAll("button.month")[2];
  click(march);
  expect(header()).toContain("March");
  expect(header()).toContain("2027");
  expect(isPickerOpen()).toBe(false);
});
