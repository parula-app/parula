// @vitest-environment happy-dom
// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../logic/app";
import WindowHeader from "../../MainWindow/WindowHeader.svelte";
import CalendarApp from "../../Calendar/CalendarApp.svelte";
import { tabsInTitleBar } from "../../Shared/Ribbon/Ribbon.svelte";
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
  tabsInTitleBar.value = true;
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

test("The setting moves the tabs between the title bar and their own row above the ribbon. Tell me stays in the title bar.", () => {
  tabsInTitleBar.value = false;
  flushSync();
  expect(document.querySelector(".title-bar [role=tab]")).toBeNull();
  expect(document.querySelector(".ribbon > .tab-row + .ribbon-content")).toBeTruthy();
  expect(document.querySelector(".title-bar .tell-me-button")).toBeTruthy();

  tabsInTitleBar.value = true;
  flushSync();
  expect(document.querySelector(".title-bar [role=tab]")).toBeTruthy();
  expect(document.querySelector(".ribbon .tab-row")).toBeNull();
});
