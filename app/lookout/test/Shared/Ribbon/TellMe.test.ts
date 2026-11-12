// @vitest-environment happy-dom
import TellMe from "../../../Shared/Ribbon/TellMe.svelte";
import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

let app: Record<string, any> | null = null;

beforeEach(() => {
  let ribbonEl = document.createElement("div");
  document.body.append(ribbonEl);
  app = mount(TellMe, { target: ribbonEl, props: { ribbonEl } });
  flushSync();
});

afterEach(() => {
  unmount(app);
  app = null;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

/** Presses Alt+Q and returns whether someone handled it */
function pressAltQ(target: HTMLElement = document.body, key = "q"): boolean {
  let event = new KeyboardEvent("keydown", { key, code: "KeyQ", altKey: true, cancelable: true, bubbles: true });
  target.dispatchEvent(event);
  return event.defaultPrevented;
}

function tellMeInput(): HTMLInputElement | null {
  return document.querySelector(".tell-me-input");
}

test("Alt+Q opens Tell me and goes to its field", async () => {
  expect(tellMeInput()).toBeNull();
  expect(pressAltQ()).toBe(true);
  await vi.waitFor(() => expect(document.activeElement).toBe(tellMeInput()));
});

test("A hidden Tell me leaves Alt+Q to others", () => {
  vi.spyOn(Element.prototype, "getClientRects").mockReturnValue([] as unknown as DOMRectList);
  expect(pressAltQ()).toBe(false);
  flushSync();
  expect(tellMeInput()).toBeNull();
});

test("Alt+Q in the text editor stays with the editor", () => {
  let editor = document.createElement("div");
  editor.setAttribute("contenteditable", "true");
  document.body.append(editor);
  expect(pressAltQ(editor)).toBe(false);
  flushSync();
  expect(tellMeInput()).toBeNull();
});

test("A key that someone else handled stays with them", () => {
  let pageListener = (event: KeyboardEvent) => event.preventDefault();
  window.addEventListener("keydown", pageListener, { capture: true });
  pressAltQ();
  window.removeEventListener("keydown", pageListener, { capture: true });
  flushSync();
  expect(tellMeInput()).toBeNull();
});

test("Option+Q types a character on macOS", () => {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)");
  expect(pressAltQ(document.body, "œ")).toBe(false);
  flushSync();
  expect(tellMeInput()).toBeNull();
});
