// @vitest-environment happy-dom
// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { MailAccount } from "../../../../logic/Mail/MailAccount";
import { MailIdentity } from "../../../../logic/Mail/MailIdentity";
import { DummyMailStorage } from "../../../../logic/Mail/Store/DummyMailStorage";
import { gLicense } from "../../../../logic/util/License";
import { sleep } from "../../../../logic/util/util";
import IdentityBlock from "../../../../frontend/Settings/Mail/Account/IdentityBlock.svelte";
import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";

beforeAll(() => {
  (globalThis as any).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

let identity: MailIdentity;
let app: Record<string, any> | null = null;

beforeEach(() => {
  appGlobal.remoteApp = {} as any;
  gLicense.license = { valid: true };
  let account = new MailAccount();
  account.name = "Test";
  account.emailAddress = "user@example.com";
  account.storage = new DummyMailStorage();
  identity = new MailIdentity(account);
  identity.emailAddress = account.emailAddress;
  identity.signatureHTML = "<p>Fred</p>";
  identity.altSignatures.addAll(["<p>Fred, CTO</p>", "<p>Fred, Treasurer</p>"]);
  account.identities.add(identity);
});

afterEach(() => {
  unmount(app);
  app = null;
  document.body.innerHTML = "";
});

async function mountBlock() {
  let target = document.createElement("div");
  document.body.append(target);
  app = mount(IdentityBlock, { target, props: { identity } });
  flushSync();
  // The text editors start asynchronously
  await vi.waitFor(() => expect(document.querySelectorAll(".signature [contenteditable]").length)
    .toBe(1 + identity.altSignatures.length));
}

function editorTexts(): string[] {
  return Array.from(document.querySelectorAll(".signature [contenteditable]")).map(e => e.textContent);
}

function button(label: string): HTMLButtonElement {
  let found = Array.from(document.querySelectorAll("button"))
    .filter(button => button.title == label || button.textContent.trim() == label);
  expect(found.length).toBeGreaterThan(0);
  return found[0] as HTMLButtonElement;
}

test("Settings show the default and the extra signatures", async () => {
  await mountBlock();
  expect(editorTexts()).toEqual(["Fred", "Fred, CTO", "Fred, Treasurer"]);
});

test("Add alternative signature adds an empty one, and the trash button deletes the right one", async () => {
  await mountBlock();
  button("Add alternative signature").click();
  await sleep(0);
  flushSync();
  expect(identity.altSignatures.contents).toEqual(["<p>Fred, CTO</p>", "<p>Fred, Treasurer</p>", ""]);
  await vi.waitFor(() => expect(editorTexts()).toEqual(["Fred", "Fred, CTO", "Fred, Treasurer", ""]));

  let deleteButtons = Array.from(document.querySelectorAll("button"))
    .filter(button => button.title == "Delete this signature");
  expect(deleteButtons.length).toBe(3);
  deleteButtons[0].click();
  await sleep(0);
  flushSync();
  expect(identity.altSignatures.contents).toEqual(["<p>Fred, Treasurer</p>", ""]);
  await vi.waitFor(() => expect(editorTexts()).toEqual(["Fred", "Fred, Treasurer", ""]));
  expect(identity.signatureHTML).toBe("<p>Fred</p>");
});
