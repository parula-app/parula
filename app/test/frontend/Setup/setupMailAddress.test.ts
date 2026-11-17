// @vitest-environment happy-dom
// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../logic/app";
import SetupMail from "../../../frontend/Setup/Mail/SetupMail.svelte";
import { flushSync, mount, unmount } from "svelte";
import { afterEach, expect, test } from "vitest";

let setupE: Record<string, any>;

afterEach(() => {
  setupE && unmount(setupE);
  document.body.innerHTML = "";
});

function button(label: string): HTMLButtonElement {
  let found = [...document.body.querySelectorAll("button")]
    .find(button => button.textContent?.trim() == label);
  expect(found, `Button [${label}] not found`).toBeTruthy();
  return found as HTMLButtonElement;
}

function type(value: string, selector: string) {
  let input = document.body.querySelector(selector) as HTMLInputElement;
  expect(input, `Input ${selector} not found`).toBeTruthy();
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  flushSync();
}

/** A username instead of an email address passed the wizard and was saved.
 * The account then failed to load on the next start. Error log PARULA-146. */
test("The setup does not continue until the email address is one", () => {
  setupE = mount(SetupMail, { target: document.body, props: {} });
  flushSync();
  expect(button("Next").disabled).toBe(true);

  type("hunter2", `input[type="password"]`);
  type("somebody", `input[type="email"]`);
  expect(button("Next").disabled).toBe(true); // no domain at all
  // Manual setup takes the same address, so it must not be a way around this
  expect(button("Manual setup").disabled).toBe(true);

  type("somebody@example", `input[type="email"]`);
  expect(button("Next").disabled).toBe(true); // no top-level domain

  type("somebody@example.com", `input[type="email"]`);
  expect(button("Next").disabled).toBe(false);
  expect(button("Manual setup").disabled).toBe(false);
});
