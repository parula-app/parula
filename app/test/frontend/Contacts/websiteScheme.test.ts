// @vitest-environment happy-dom
// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../logic/app";
import URLEdit from "../../../frontend/Contacts/PersonPage/URLEdit.svelte";
import URLDisplay from "../../../frontend/Contacts/PersonPage/URLDisplay.svelte";
import { flushSync, mount, unmount } from "svelte";
import { afterEach, expect, test } from "vitest";

let component: Record<string, any> | null = null;

afterEach(() => {
  if (component) {
    unmount(component);
    component = null;
  }
  document.body.innerHTML = "";
});

/** Types `value` into the website field, leaves it, and returns what the field saves */
function typeWebsite(value: string): string {
  let saved = "";
  component = mount(URLEdit, { target: document.body, props: { get value() { return saved; }, set value(value) { saved = value; } } });
  let input = document.querySelector("input");
  input.value = value;
  input.dispatchEvent(new Event("input"));
  input.dispatchEvent(new Event("change"));
  flushSync();
  return saved;
}

test("Editing: a website typed without https:// is saved with it", () => {
  expect(typeWebsite("erika.example")).toBe("https://erika.example");
});

test("Editing: a website with http:// stays as it is", () => {
  expect(typeWebsite("http://erika.example/")).toBe("http://erika.example/");
  expect(document.body.textContent).not.toContain("not a web address");
});

test("Editing: a value that is not a web address shows an error", () => {
  expect(typeWebsite("erika example")).toBe("erika example");
  expect(document.body.textContent).toContain("not a web address");
});

test("Display: a website saved without https:// links to https://", () => {
  component = mount(URLDisplay, { target: document.body, props: { value: "erika.example" } });
  flushSync();
  let link = document.querySelector("a");
  expect(link.getAttribute("href")).toBe("https://erika.example");
  expect(link.textContent).toContain("erika.example");
});
