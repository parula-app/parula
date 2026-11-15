// @vitest-environment happy-dom
// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../logic/app";
import WindowHeader from "../../MainWindow/WindowHeader.svelte";
import CalendarApp from "../../Calendar/CalendarApp.svelte";
import { getLocalStorage } from "../../../frontend/Util/LocalStorage";
import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeAll, beforeEach, expect, test } from "vitest";

beforeAll(() => {
  (globalThis as any).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  HTMLCanvasElement.prototype.getContext = (() => null) as any;
  Element.prototype.scrollTo ??= () => {};
});

let header: Record<string, any> | null = null;
let page: Record<string, any> | null = null;

beforeEach(() => {
  localStorage.clear();
  header = mount(WindowHeader, { target: document.body, props: { selectedApp: null } });
  page = mount(CalendarApp, { target: document.body });
  flushSync();
});

afterEach(() => {
  if (page) {
    unmount(page);
  }
  unmount(header);
  page = null;
  header = null;
  document.body.innerHTML = "";
});

test("The ribbon tabs are in the title bar, and go away with their page", () => {
  let titleBar = document.querySelector(".title-bar");
  expect(titleBar.querySelector("[role=tab]")).toBeTruthy();
  expect(document.querySelector(".ribbon [role=tab]")).toBeNull();

  unmount(page);
  page = null;
  flushSync();
  expect(titleBar.querySelector("[role=tab]")).toBeNull();
});

test("Collapsed ribbon: A tab in the title bar shows the ribbon, and a click elsewhere hides it", () => {
  getLocalStorage<boolean>("lookout.ribbon.collapsed", false).value = true;
  flushSync();
  let ribbon = document.querySelector(".ribbon");
  expect(ribbon.classList.contains("temp-open")).toBe(false);

  document.querySelector<HTMLElement>(".title-bar [role=tab]").click();
  flushSync();
  expect(ribbon.classList.contains("temp-open")).toBe(true);

  document.body.click();
  flushSync();
  expect(ribbon.classList.contains("temp-open")).toBe(false);
});
