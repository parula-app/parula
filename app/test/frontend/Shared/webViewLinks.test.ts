// @vitest-environment happy-dom
// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../logic/app";
import WebView from "../../../frontend/Shared/WebView.svelte";
import { waitFor } from "../../logic/util/waitFor";
import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeEach, expect, test } from "vitest";

/** The handlers that `WebView` registers in the main process for events of its `<webview>`, by event */
let handlers: Record<string, Function[]>;
/** The URLs that the app opened in the browser */
let opened: string[];
let webView: Record<string, any> | null = null;

beforeEach(() => {
  localStorage.clear();
  handlers = {};
  opened = [];
  appGlobal.remoteApp = {
    addEventListenerWebContents: async (id: number, event: string, handler: Function) => {
      (handlers[event] ??= []).push(handler);
    },
    openExternalURL: async (url: string) => {
      opened.push(url);
    },
  } as any;
});

afterEach(() => {
  if (webView) {
    unmount(webView);
    webView = null;
  }
  document.body.innerHTML = "";
});

/** Shows the mail, and lets `WebView` register its handlers, like when Electron loaded it */
async function showMail(html: string) {
  webView = mount(WebView, { target: document.body, props: { html, title: "Mail", askBeforeOpeningLinks: true } });
  flushSync();
  let webviewE = document.querySelector("webview") as any;
  webviewE.getWebContentsId = () => 1;
  webviewE.dispatchEvent(new Event("dom-ready"));
  await waitFor(() => handlers["input-event"]?.length == 2);
}

/** Calls the handlers like the main process does, when the user clicks on a link */
async function clickOnLink(url: string) {
  for (let handler of handlers["update-target-url"]) {
    await handler(url);
  }
  for (let handler of handlers["input-event"]) {
    await handler({ type: "mouseDown", button: "left", x: 50, y: 20 });
  }
  flushSync();
}

test("A click on a link in a mail shows where it goes", async () => {
  await showMail(`<p><a href="https://a.b.d.foo.com/dtghdfhj">Q3 slides</a></p>`);
  await clickOnLink("https://a.b.d.foo.com/dtghdfhj");
  expect(document.querySelector(".open-link-popup .domain")?.textContent).toContain("foo.com");
  expect(opened).toEqual([]);
});

test("A click on a link to an allowed domain opens it at once", async () => {
  localStorage.setItem("links.openWithoutAsking.domains", JSON.stringify(["foo.com"]));
  await showMail(`<p><a href="https://a.b.d.foo.com/dtghdfhj">Q3 slides</a></p>`);
  await clickOnLink("https://a.b.d.foo.com/dtghdfhj");
  expect(document.querySelector(".open-link-popup")).toBeNull();
  expect(opened).toEqual(["https://a.b.d.foo.com/dtghdfhj"]);
});

test("A click on a tracking link to an allowed domain opens the page without the tracker", async () => {
  localStorage.setItem("links.openWithoutAsking.domains", JSON.stringify(["shop.com"]));
  await showMail(`<p><a href="https://click.tracker.com/c?u=https%3A%2F%2Fwww.shop.com%2Fshoes">Shoes</a></p>`);
  await clickOnLink("https://click.tracker.com/c?u=https%3A%2F%2Fwww.shop.com%2Fshoes");
  expect(document.querySelector(".open-link-popup")).toBeNull();
  expect(opened).toEqual(["https://www.shop.com/shoes"]);
});
