// @vitest-environment happy-dom
// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import HTMLEditor from "../../../../frontend/Shared/Editor/HTMLEditor.svelte";
import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeAll, expect, test } from "vitest";

beforeAll(() => {
  appGlobal.remoteApp = {} as any;
});

let editor: Record<string, any> | null = null;

afterEach(() => {
  if (editor) {
    unmount(editor);
    editor = null;
  }
  document.body.innerHTML = "";
});

/** The editor renders the document with the same `renderHTML()` that `getHTML()` uses,
 * so the attributes on this anchor are the ones we save and send to the server. */
function showEditor(html: string): HTMLAnchorElement {
  let target = document.createElement("div");
  document.body.append(target);
  editor = mount(HTMLEditor, { target, props: { html } });
  flushSync();
  return document.querySelector("a");
}

test("A link carries only the attributes that the author wrote", () => {
  let anchor = showEditor(`<p><a href="https://example.com/">link</a></p>`);

  expect(anchor.getAttribute("href")).toBe("https://example.com/");
  // `sanitizeHTML()` adds these when rendering, so the document must not carry them
  expect(anchor.getAttribute("rel")).toBe(null);
  expect(anchor.getAttribute("target")).toBe(null);
});

test("A link keeps the rel that the server sent", () => {
  let anchor = showEditor(`<p><a href="https://example.com/" rel="nofollow">link</a></p>`);

  expect(anchor.getAttribute("rel")).toBe("nofollow");
});
