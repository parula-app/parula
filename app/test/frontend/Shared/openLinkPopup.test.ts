// @vitest-environment happy-dom
// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../logic/app";
import OpenLinkPopup, { askBeforeOpening } from "../../../frontend/Shared/OpenLinkPopup.svelte";
import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeAll, beforeEach, expect, test } from "vitest";

const kPref = "links.openWithoutAsking.domains";

beforeAll(() => {
  appGlobal.remoteApp = {} as any;
});

beforeEach(() => {
  localStorage.clear();
});

let popup: Record<string, any> | null = null;

afterEach(() => {
  if (popup) {
    unmount(popup);
    popup = null;
  }
  document.body.innerHTML = "";
});

async function showPopup(url: string): Promise<HTMLElement> {
  let anchor = { getBoundingClientRect: () => new DOMRect(10, 10, 0, 0) };
  popup = mount(OpenLinkPopup, { target: document.body, props: { popupAnchor: anchor } });
  await popup.show(url);
  flushSync();
  return document.querySelector(".open-link-popup");
}

test("Asks before opening web links", () => {
  expect(askBeforeOpening("https://a.b.d.foo.com/dtghdfhj")).toBe(true);
  expect(askBeforeOpening("http://foo.com/")).toBe(true);
});

test("Does not ask for the domains that the user allowed", () => {
  localStorage.setItem(kPref, JSON.stringify(["foo.com"]));
  expect(askBeforeOpening("https://a.b.d.foo.com/dtghdfhj")).toBe(false);
  expect(askBeforeOpening("http://foo.com/")).toBe(false);
  expect(askBeforeOpening("https://foo.com.evil.example/")).toBe(true);
  expect(askBeforeOpening("https://notfoo.com/")).toBe(true);
});

test("Opens mailto: and other non-web links without asking, as before", () => {
  expect(askBeforeOpening("mailto:fred@foo.com")).toBe(false);
  expect(askBeforeOpening("tel:+1234567")).toBe(false);
  expect(askBeforeOpening("not a URL")).toBe(false);
});

test("A broken preference doesn't stop links", () => {
  localStorage.setItem(kPref, JSON.stringify("foo.com"));
  expect(askBeforeOpening("https://foo.com/")).toBe(true);
});

test("Shows the base domain and the full URL", async () => {
  let url = "https://a.b.d.foo.co.uk/dtghdfhj?x=1";
  let popupE = await showPopup(url);
  expect(popupE.querySelector(".domain").textContent).toBe("foo.co.uk");
  expect(popupE.querySelector(".url").textContent).toBe(url);
  expect(popupE.querySelector(".checkbox label").textContent).toContain("foo.co.uk");
  expect((popupE.querySelector(".checkbox input") as HTMLInputElement).checked).toBe(false);
  expect(document.activeElement?.textContent).toContain("Open in browser");
});

test("The checkbox remembers the domain, and forgets it again", async () => {
  localStorage.setItem(kPref, JSON.stringify(["bar.org"]));
  let popupE = await showPopup("https://a.b.d.foo.com/dtghdfhj");
  (popupE.querySelector(".checkbox label") as HTMLElement).click();
  flushSync();
  expect(JSON.parse(localStorage.getItem(kPref))).toEqual(["bar.org", "foo.com"]);
  expect(askBeforeOpening("https://www.foo.com/other")).toBe(false);

  (popupE.querySelector(".checkbox input") as HTMLElement).click();
  flushSync();
  expect(JSON.parse(localStorage.getItem(kPref))).toEqual(["bar.org"]);
});

test("Escape closes the popup", async () => {
  let popupE = await showPopup("https://foo.com/");
  popupE.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  flushSync();
  expect(document.querySelector(".open-link-popup")).toBeNull();
});
