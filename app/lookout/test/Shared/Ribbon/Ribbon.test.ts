// @vitest-environment happy-dom
import Ribbon from "../../../Shared/Ribbon/Ribbon.svelte";
import { getLocalStorage } from "../../../../frontend/Util/LocalStorage";
import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeAll, beforeEach, expect, test } from "vitest";

beforeAll(() => {
  (globalThis as any).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

let ribbons: Record<string, any>[] = [];

function mountRibbon(id: string) {
  let target = document.createElement("div");
  document.body.append(target);
  ribbons.push(mount(Ribbon, { target, props: { id } }));
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
