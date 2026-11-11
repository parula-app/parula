// @vitest-environment happy-dom
// before DOMPurify loads
import "../Util/happyDOMForDOMPurify";
// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../logic/app";
import OpenLinkPopup, { askBeforeOpening } from "../../../frontend/Shared/OpenLinkPopup.svelte";
import { sanitizeHTML } from "../../../logic/util/convertHTML";
import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";

const kPref = "links.openWithoutAsking.domains";

/** The URLs that the app opened in the browser or in another app */
let opened: string[] = [];

beforeAll(() => {
  appGlobal.remoteApp = {
    openExternalURL: async (url: string) => {
      opened.push(url);
    },
  } as any;
});

beforeEach(() => {
  localStorage.clear();
  opened = [];
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
  // for Return and Escape
  expect(document.activeElement).toBe(popupE);
});

test("A link without a web domain shows a warning, and nothing to remember", async () => {
  let popupE = await showPopup("mailto:fred@foo.com");
  let headingE = popupE.querySelector(".domain");
  expect(headingE.classList.contains("unknown")).toBe(true);
  expect(headingE.textContent.trim()).not.toBe("");
  expect(popupE.querySelector(".url").textContent).toContain("fred@foo.com");
  expect(popupE.querySelector(".checkbox")).toBeNull();
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

function pressKey(element: Element, key: string) {
  element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  flushSync();
}

test("Return opens the link in the browser", async () => {
  await showPopup("https://a.b.d.foo.com/dtghdfhj");
  pressKey(document.activeElement, "Enter");
  await Promise.resolve();
  expect(opened).toEqual(["https://a.b.d.foo.com/dtghdfhj"]);
  expect(document.querySelector(".open-link-popup")).toBeNull();
});

test("Return on [Copy link] leaves the action to that button", async () => {
  let popupE = await showPopup("https://foo.com/");
  let copyButton = popupE.querySelector(`button[title="Copy link"]`);
  pressKey(copyButton, "Enter");
  await Promise.resolve();
  expect(opened).toEqual([]);
});

test("[Cancel] closes the popup, and opens nothing", async () => {
  let popupE = await showPopup("https://foo.com/");
  let cancelButton = [...popupE.querySelectorAll("button")].find(button => button.textContent.includes("Cancel"));
  cancelButton.click();
  await Promise.resolve();
  flushSync();
  expect(document.querySelector(".open-link-popup")).toBeNull();
  expect(opened).toEqual([]);
});

test("Escape closes the popup, and opens nothing", async () => {
  await showPopup("https://foo.com/");
  pressKey(document.activeElement, "Escape");
  await Promise.resolve();
  expect(document.querySelector(".open-link-popup")).toBeNull();
  expect(opened).toEqual([]);
});

test("Return after checking the checkbox opens the link", async () => {
  let popupE = await showPopup("https://foo.com/");
  (popupE.querySelector(".checkbox input") as HTMLElement).click();
  flushSync();
  pressKey(document.activeElement, "Enter");
  await Promise.resolve();
  expect(opened).toEqual(["https://foo.com/"]);
});

/** A link in a mail, and what a click on it does */
interface LinkCase {
  name: string;
  html: string;
  /** What a click on each link that's left after the sanitizer does, in document order.
   * "popup: <domain that it shows>", "OS app" or "nothing".
   * Empty: No link left. */
  clicks: string[];
}

const kLinkCases: LinkCase[] = [
  // Normal links
  { name: "normal link", html: `<a href="https://a.b.d.foo.com/dtghdfhj">Q3 slides</a>`, clicks: ["popup: foo.com"] },
  { name: "http link", html: `<a href="http://foo.com/">Q3 slides</a>`, clicks: ["popup: foo.com"] },
  { name: "image link", html: `<a href="https://foo.com/offer"><img src="cid:banner@foo.com" alt="Offer"></a>`, clicks: ["popup: foo.com"] },
  { name: "link around formatted text", html: `<a href="https://www.foo.com/"><b>Bold</b> <span style="color: red">and red</span></a>`, clicks: ["popup: foo.com"] },
  { name: "link with target=_top", html: `<a href="https://foo.com/" target="_top">Q3 slides</a>`, clicks: ["popup: foo.com"] },
  { name: "link that tracks the click with ping", html: `<a href="https://foo.com/" ping="https://evil.com/track">Q3 slides</a>`, clicks: ["popup: foo.com"] },
  { name: "link with onclick", html: `<a href="https://foo.com/" onclick="location='https://evil.com/'">Q3 slides</a>`, clicks: ["popup: foo.com"] },
  // Web links that hide where they go. The popup must show the real domain.
  { name: "trusted domain as user name", html: `<a href="https://foo.com@evil.com/">foo.com</a>`, clicks: ["popup: evil.com"] },
  { name: "trusted domain as subdomain", html: `<a href="https://foo.com.evil.co.uk/login">foo.com</a>`, clicks: ["popup: evil.co.uk"] },
  { name: "backslashes", html: `<a href="https:\\\\evil.com/">foo.com</a>`, clicks: ["popup: evil.com"] },
  { name: "upper case", html: `<a href="HTTPS://EVIL.COM/">foo.com</a>`, clicks: ["popup: evil.com"] },
  { name: "spaces around the URL", html: `<a href="  https://evil.com/  ">foo.com</a>`, clicks: ["popup: evil.com"] },
  { name: "tab in the scheme", html: `<a href="ht&#x09;tps://evil.com/">foo.com</a>`, clicks: ["popup: evil.com"] },
  { name: "percent-encoded domain", html: `<a href="https://%65vil.com/">foo.com</a>`, clicks: ["popup: evil.com"] },
  { name: "look-alike letters", html: `<a href="https://раypal.com/">paypal.com</a>`, clicks: ["popup: xn--ypal-43d9g.com"] },
  { name: "IP address in hex", html: `<a href="http://0x7f.1/">foo.com</a>`, clicks: ["popup: 127.0.0.1"] },
  { name: "invisible link over the whole mail", html: `<a href="https://evil.com/" style="position: fixed; inset: 0; opacity: 0">x</a>`, clicks: ["popup: evil.com"] },
  { name: "link inside a link", html: `<a href="https://foo.com/"><a href="https://evil.com/">foo.com</a></a>`, clicks: ["popup: foo.com", "popup: evil.com"] },
  { name: "link that clobbers window.location", html: `<a href="https://evil.com/" id="location" name="location">foo.com</a>`, clicks: ["popup: evil.com"] },
  // Not a web page: Opens the mail or phone app of the OS, as before
  { name: "mailto:", html: `<a href="mailto:fred@foo.com">Fred</a>`, clicks: ["OS app"] },
  { name: "tel:", html: `<a href="tel:+491234567">Call</a>`, clicks: ["OS app"] },
  { name: "xmpp:", html: `<a href="xmpp:fred@foo.com">Chat</a>`, clicks: ["OS app"] },
  { name: "matrix:", html: `<a href="matrix:u/fred:foo.com">Chat</a>`, clicks: ["OS app"] },
  // The sanitizer keeps the link, but it opens nothing
  { name: "relative link", html: `<a href="/login">foo.com</a>`, clicks: ["nothing"] },
  { name: "link without scheme", html: `<a href="//evil.com/">foo.com</a>`, clicks: ["nothing"] },
  { name: "<base> with relative link", html: `<base href="https://evil.com/"><a href="login">foo.com</a>`, clicks: ["nothing"] },
  { name: "ftp:", html: `<a href="ftp://evil.com/">foo.com</a>`, clicks: ["nothing"] },
  { name: "cid:", html: `<a href="cid:part1@foo.com">foo.com</a>`, clicks: ["nothing"] },
  { name: "sms:", html: `<a href="sms:+491234567">foo.com</a>`, clicks: ["nothing"] },
  { name: "image map", html: `<img src="cid:map@foo.com" usemap="#m"><map name="m"><area shape="rect" coords="0,0,10,10" href="https://evil.com/"></map>`, clicks: ["nothing"] },
  // Hostile: The sanitizer must remove them
  { name: "javascript:", html: `<a href="javascript:alert(1)">foo.com</a>`, clicks: [] },
  { name: "javascript: in mixed case", html: `<a href="JaVaScRiPt:alert(1)">foo.com</a>`, clicks: [] },
  { name: "javascript: as entities", html: `<a href="&#106;&#97;vascript&colon;alert(1)">foo.com</a>`, clicks: [] },
  { name: "javascript: with a tab", html: `<a href="java&#x09;script:alert(1)">foo.com</a>`, clicks: [] },
  { name: "javascript: with a newline", html: `<a href="java\nscript:alert(1)">foo.com</a>`, clicks: [] },
  { name: "javascript: after spaces", html: `<a href=" &#x20; javascript:alert(1)">foo.com</a>`, clicks: [] },
  { name: "vbscript:", html: `<a href="vbscript:msgbox(1)">foo.com</a>`, clicks: [] },
  { name: "data: HTML page", html: `<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">foo.com</a>`, clicks: [] },
  { name: "data: image", html: `<a href="data:image/png;base64,iVBORw0KGgo=">foo.com</a>`, clicks: [] },
  { name: "file:", html: `<a href="file:///C:/Windows/System32/calc.exe">foo.com</a>`, clicks: [] },
  { name: "Windows ms-msdt: exploit", html: `<a href="ms-msdt:/id PCWDiagnostic /skip force">foo.com</a>`, clicks: [] },
  { name: "Windows search-ms:", html: `<a href="search-ms:query=invoice&crumb=location:\\\\evil.com\\share">foo.com</a>`, clicks: [] },
  { name: "blob:", html: `<a href="blob:https://evil.com/0a1b2c">foo.com</a>`, clicks: [] },
  { name: "about:", html: `<a href="about:blank">foo.com</a>`, clicks: [] },
  { name: "Android intent:", html: `<a href="intent://evil.com#Intent;scheme=https;end">foo.com</a>`, clicks: [] },
  { name: "xlink:href", html: `<a xlink:href="https://evil.com/">foo.com</a>`, clicks: [] },
  { name: "SVG link", html: `<svg><a href="https://evil.com/"><text>foo.com</text></a></svg>`, clicks: [] },
  { name: "MathML link", html: `<math href="https://evil.com/"><mi>foo.com</mi></math>`, clicks: [] },
  { name: "form", html: `<form action="https://evil.com/"><button>foo.com</button></form>`, clicks: [] },
  { name: "button with formaction", html: `<button formaction="https://evil.com/">foo.com</button>`, clicks: [] },
  { name: "meta refresh", html: `<meta http-equiv="refresh" content="0; url=https://evil.com/">`, clicks: [] },
  { name: "iframe", html: `<iframe src="https://evil.com/"></iframe>`, clicks: [] },
  { name: "object and embed", html: `<object data="https://evil.com/page.html"></object><embed src="https://evil.com/page.html">`, clicks: [] },
  { name: "div with onclick", html: `<div onclick="location='https://evil.com/'">foo.com</div>`, clicks: [] },
];

/** The URL of the mail in the `<webview>`. Links resolve against it. */
const kMailURL = "blob:http://localhost:5454/0f8a2c4e-5b6d-4e7f-9a1b-2c3d4e5f6a7b";

/** What happens when the user clicks on this link in the mail */
async function clickOn(link: Element): Promise<string> {
  // The URL that `addLinkListener()` in `WebView.svelte` gets from Chromium
  let url: string;
  try {
    url = new URL(link.getAttribute("href"), kMailURL).href;
  } catch (ex) {
    return "nothing";
  }
  if (askBeforeOpening(url)) {
    let popupE = await showPopup(url);
    let domain = popupE.querySelector(".domain").textContent;
    unmount(popup);
    popup = null;
    return "popup: " + domain;
  }
  // Else, `addLinkListener()` calls `openExternalURL()`
  // <copied from="../../../../desktop/backend/backend.ts" function="openExternalURL()">
  const kAllowedURLSchemes = [
    "https:",
    "http:",
    "mailto:",
    "tel:",
    "xmpp:",
    "matrix:",
  ];
  // </copied>
  let scheme = new URL(url).protocol;
  if (!kAllowedURLSchemes.includes(scheme)) {
    return "nothing"; // `openExternalURL()` refuses to open it
  }
  return scheme.startsWith("http") ? "browser, without asking" : "OS app";
}

describe("A mail with all kinds of links", () => {
  let mail: Document;

  beforeAll(() => {
    let html = kLinkCases.map(linkCase => `<div data-case="${linkCase.name}">${linkCase.html}</div>`).join("\n");
    mail = new DOMParser().parseFromString(sanitizeHTML(html), "text/html");
  });

  test.each(kLinkCases)("$name", async (linkCase) => {
    let caseE = mail.querySelector(`[data-case="${linkCase.name}"]`);
    expect(caseE).not.toBeNull();
    let clicks = [];
    for (let link of caseE.querySelectorAll("a[href], area[href]")) {
      clicks.push(await clickOn(link));
    }
    expect(clicks).toEqual(linkCase.clicks);
  });

  test("The sanitizer saw every link", () => {
    for (let link of mail.querySelectorAll("a[href]")) {
      expect(link.getAttribute("target"), link.outerHTML).toBe("_blank");
      expect(link.getAttribute("source"), link.outerHTML).toBe("convert-html");
    }
  });

  test("Nothing else in the mail can open a page or run code", () => {
    expect(mail.querySelectorAll("script, form, base, meta, iframe, frame, object, embed, svg, math")).toHaveLength(0);
    for (let element of mail.querySelectorAll("*")) {
      for (let attribute of element.attributes) {
        if (attribute.name == "data-case") {
          continue;
        }
        expect(attribute.name, element.outerHTML).not.toMatch(/^on|^(action|formaction|ping|xlink:href)$/i);
        expect(attribute.value, element.outerHTML).not.toMatch(/^[\s\0-\x1f]*(javascript|vbscript|data:text|file|ms-|search-ms|blob|about|intent):/i);
      }
    }
  });
});
