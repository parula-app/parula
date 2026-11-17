// @vitest-environment happy-dom
// app first, to resolve the import cycle around Abstract/Account.ts
import "../../../../logic/app";
import { ContactEntry, Person } from "../../../../logic/Abstract/Person";
import ContactForm from "../../../Contacts/PersonPage/ContactForm.svelte";
import AllFieldsPage from "../../../Contacts/PersonPage/AllFieldsPage.svelte";
import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeAll, expect, test } from "vitest";

beforeAll(() => {
  (globalThis as any).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollTo ??= () => {};
});

let component: Record<string, any> | null = null;

afterEach(() => {
  if (component) {
    unmount(component);
    component = null;
  }
  document.body.innerHTML = "";
});

function typeIn(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event("input"));
  input.dispatchEvent(new Event("change"));
  flushSync();
}

test("General: a web page address typed without https:// is saved with it, one that is not a web address shows an error", () => {
  let person = new Person();
  component = mount(ContactForm, { target: document.body, props: { person } });
  flushSync();
  typeIn(document.querySelector<HTMLInputElement>("#contact-web"), "erika.example");
  expect(person.urls.first.value).toBe("https://erika.example");
  expect(document.body.textContent).not.toContain("not a web address");
  typeIn(document.querySelector<HTMLInputElement>("#contact-web"), "erika example");
  expect(document.body.textContent).toContain("not a web address");
});

test("All Fields: a web page typed without https:// is saved with it, one that is not a web address shows an error", () => {
  let person = new Person();
  person.urls.add(new ContactEntry("https://old.erika.example/", "work"));
  component = mount(AllFieldsPage, { target: document.body, props: { person } });
  flushSync();
  document.querySelector<HTMLElement>(".lo-combobox").click();
  flushSync();
  [...document.querySelectorAll<HTMLElement>(".lo-menuitem")].find(item => item.textContent.includes("Web page and IM fields")).click();
  flushSync();
  typeIn(document.querySelector<HTMLInputElement>('input[aria-label="Web page"]'), "erika.example");
  expect(person.urls.first.value).toBe("https://erika.example");
  expect(document.body.textContent).not.toContain("not a web address");
  typeIn(document.querySelector<HTMLInputElement>('input[aria-label="Web page"]'), "erika example");
  expect(document.body.textContent).toContain("not a web address");
});
