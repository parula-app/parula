// @vitest-environment happy-dom
import Ribbon from "../../../Shared/Ribbon/Ribbon.svelte";
import { currentRibbon } from "../../../MainWindow/Selected";
import { isBackstageOpen } from "../../../Settings/Backstage/selected";
import { AppWindow } from "../../../../frontend/MainWindow/AppWindow";
import { getLocalStorage } from "../../../../frontend/Util/LocalStorage";
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

let ribbons: Record<string, any>[] = [];

function mountRibbon(id: string, appWindow?: AppWindow) {
  let target = document.createElement("div");
  document.body.append(target);
  let context = appWindow ? new Map([["appWindow", appWindow]]) : undefined;
  ribbons.push(mount(Ribbon, { target, props: { id }, context }));
  flushSync();
}

beforeEach(() => {
  mountRibbon("mail");
});

afterEach(() => {
  for (let ribbon of ribbons) {
    unmount(ribbon);
  }
  ribbons = [];
  document.body.innerHTML = "";
  isBackstageOpen.set(false);
});

/** Presses Ctrl+F1 and returns whether someone handled it */
function pressCtrlF1(target: HTMLElement = document.body): boolean {
  let event = new KeyboardEvent("keydown", { key: "F1", code: "F1", ctrlKey: true, cancelable: true, bubbles: true });
  target.dispatchEvent(event);
  flushSync();
  return event.defaultPrevented;
}

const collapsed = getLocalStorage<boolean>("lookout.ribbon.collapsed", false);

test("Ctrl+F1 collapses and expands the ribbon", () => {
  let wasCollapsed = !!collapsed.value;
  expect(pressCtrlF1()).toBe(true);
  expect(!!collapsed.value).toBe(!wasCollapsed);
  expect(pressCtrlF1()).toBe(true);
  expect(!!collapsed.value).toBe(wasCollapsed);
});

test("With several ribbons in the window, Ctrl+F1 toggles the shared setting once", () => {
  mountRibbon("mail-write");
  let wasCollapsed = !!collapsed.value;
  expect(pressCtrlF1()).toBe(true);
  expect(!!collapsed.value).toBe(!wasCollapsed);
});

test("Ctrl+F1 in the text editor or handled by someone else stays with them", () => {
  let wasCollapsed = !!collapsed.value;

  let editor = document.createElement("div");
  editor.setAttribute("contenteditable", "true");
  document.body.append(editor);
  expect(pressCtrlF1(editor)).toBe(false);

  let pageListener = (event: KeyboardEvent) => event.preventDefault();
  window.addEventListener("keydown", pageListener, { capture: true });
  pressCtrlF1();
  window.removeEventListener("keydown", pageListener, { capture: true });

  expect(!!collapsed.value).toBe(wasCollapsed);
});

const homeTab = { label: "Home", isContextual: false, groups: [] };

test("Selecting a ribbon tab closes the File view", () => {
  let ribbon = get(currentRibbon);
  ribbon.onFile();
  expect(get(isBackstageOpen)).toBe(true);
  ribbon.onSelectTab(homeTab);
  expect(get(isBackstageOpen)).toBe(false);
  expect(get(ribbon.selectedTab)).toBe(homeTab);
});

test("A tab in a window opened for one thing leaves the File view of the main window open", () => {
  let appWindow = new (AppWindow as any)(window, "test-window", AppWindow.main) as AppWindow;
  mountRibbon("mail-write", appWindow);
  get(currentRibbon).onFile();
  get(appWindow.uiState(currentRibbon)).onSelectTab(homeTab);
  expect(get(isBackstageOpen)).toBe(true);
});
