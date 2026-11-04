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

test("Editing: a website typed without https:// gets it when the user leaves the field", () => {
  component = mount(URLEdit, { target: document.body, props: { value: "" } });
  let input = document.querySelector("input");
  input.value = "erika.example";
  input.dispatchEvent(new Event("input"));
  input.dispatchEvent(new Event("change"));
  flushSync();
  expect(input.value).toBe("https://erika.example");
});

test("Editing: a website with https:// stays as it is", () => {
  component = mount(URLEdit, { target: document.body, props: { value: "" } });
  let input = document.querySelector("input");
  input.value = "http://erika.example/";
  input.dispatchEvent(new Event("input"));
  input.dispatchEvent(new Event("change"));
  flushSync();
  expect(input.value).toBe("http://erika.example/");
});

test("Display: a website saved without https:// links to https://", () => {
  component = mount(URLDisplay, { target: document.body, props: { value: "erika.example" } });
  flushSync();
  let link = document.querySelector("a");
  expect(link.getAttribute("href")).toBe("https://erika.example");
  expect(link.textContent).toContain("erika.example");
});
