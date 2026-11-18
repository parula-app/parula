// @vitest-environment happy-dom
// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { MailAccount } from "../../../../logic/Mail/MailAccount";
import { AutoResponder, AutoResponderAudience } from "../../../../logic/Mail/AutoResponder";
import { PermissionMissing } from "../../../../logic/Abstract/Account";
import AutoResponderPage from "../../../../frontend/Settings/Mail/AutoResponder.svelte";
import { flushSync, mount, tick, unmount } from "svelte";
import { afterEach, beforeAll, expect, test, vi } from "vitest";

beforeAll(() => {
  appGlobal.remoteApp = {} as any;
});

/** What the server has */
let server: Partial<AutoResponder>;

class TestAutoResponder extends AutoResponder {
  get supported() {
    return true;
  }
  get supportsInternal() {
    return true;
  }
  get supportsContacts() {
    return true;
  }

  async load() {
    Object.assign(this, server);
  }

  async save() {
    server = {
      isOn: this.isOn,
      scheduled: this.scheduled,
      internalHTML: this.internalHTML,
      externalHTML: this.externalHTML,
      externalAudience: this.externalAudience,
    };
  }
}

/** Login from before we asked for the permission */
let granted: boolean;
class DeniedResponder extends TestAutoResponder {
  async load() {
    if (!granted) {
      throw new PermissionMissing(null, "Please log in once more and allow access.");
    }
    await super.load();
  }
}

let responderClass: typeof TestAutoResponder;

class TestMailAccount extends MailAccount {
  newAutoResponder() {
    return new responderClass(this);
  }

  async upgradeScopes() {
    granted = true;
  }
}

let target: HTMLElement;
let app: any;

afterEach(() => {
  unmount(app);
  target.remove();
  vi.restoreAllMocks();
});

async function showPage(type = TestAutoResponder): Promise<TestMailAccount> {
  server = {
    isOn: true,
    scheduled: false,
    internalHTML: "<p>Back on Monday</p>",
    externalHTML: "<p>Away</p>",
    externalAudience: AutoResponderAudience.None,
  };
  granted = false;
  responderClass = type;
  let account = new TestMailAccount();
  target = document.createElement("div");
  document.body.append(target);
  app = mount(AutoResponderPage, { target, props: { account } });
  await settle();
  return account;
}

async function settle() {
  await tick(); // `load()`
  await tick();
  flushSync();
}

function find(selector: string, text: string): HTMLElement {
  let found = [...target.querySelectorAll<HTMLElement>(selector)]
    .filter(el => el.textContent.trim() == text);
  expect(found.length, `${selector} ${text}`).toBe(1);
  return found[0];
}

function radio(label: string): HTMLInputElement {
  return find("label.radio", label).querySelector("input");
}

function checkbox(label: string): HTMLInputElement {
  return find(".checkbox", label).querySelector("input");
}

function button(label: string): HTMLButtonElement {
  return find("button", label) as HTMLButtonElement;
}

async function click(el: HTMLElement) {
  el.click();
  flushSync();
  await settle();
}

/** The editor for inside the organization, or with `outside` the one for outside */
function editorBox(outside = false): HTMLElement {
  return target.querySelectorAll<HTMLElement>(".editor-box")[outside ? 1 : 0];
}

function dateInput(): HTMLInputElement {
  return target.querySelector("input[type=date]");
}

test("Shows the settings from the server, and Save saves them", async () => {
  let account = await showPage();
  await account.autoResponder.load();

  expect(radio("Always send automatic replies").checked).toBe(true);
  expect(radio("Only send during this time range:").checked).toBe(false);
  expect(editorBox().textContent).toContain("Back on Monday");

  await click(radio("Do not send automatic replies"));
  expect(server.isOn).toBe(true);
  expect(account.autoResponder.isOn).toBe(true);
  await click(button("Save"));
  expect(server.isOn).toBe(false);
  expect(account.autoResponder.isOn).toBe(false);
});

test("Only send during this time range, and without automatic replies, the time range and the message are disabled", async () => {
  await showPage();
  expect(dateInput().disabled).toBe(true);
  await click(radio("Only send during this time range:"));
  expect(radio("Always send automatic replies").checked).toBe(false);
  expect(dateInput().disabled).toBe(false);
  expect(editorBox().inert).toBe(false);

  await click(radio("Do not send automatic replies"));
  expect(radio("Only send during this time range:").checked).toBe(false);
  expect(dateInput().disabled).toBe(true);
  expect(editorBox().inert).toBe(true);

  await click(radio("Only send during this time range:"));
  await click(button("Save"));
  expect(server.isOn).toBe(true);
  expect(server.scheduled).toBe(true);
});

test("Outside the organization: on with the checkbox, with its own message below the one for inside", async () => {
  await showPage();

  expect(target.textContent).toContain("Inside My Organization");
  expect(target.textContent).toContain("Outside My Organization");
  expect(editorBox().textContent).toContain("Back on Monday");
  expect(editorBox(true).textContent).toContain("Away");
  expect(editorBox().inert).toBe(false);
  expect(editorBox(true).inert).toBe(true);
  expect(radio("Anyone outside my organization").disabled).toBe(true);

  await click(checkbox("Auto-reply to people outside my organization"));
  expect(radio("Anyone outside my organization").checked).toBe(true);
  expect(editorBox(true).inert).toBe(false);
  await click(radio("My Contacts only"));
  await click(button("Save"));
  expect(server.externalAudience).toBe(AutoResponderAudience.Contacts);
});

/** E.g. EWS, when the admin allows only contacts outside the organization */
class ContactsOnlyResponder extends TestAutoResponder {
  async load() {
    await super.load();
    this.maxAudience = AutoResponderAudience.Contacts;
  }
}

test("The admin allows only contacts outside the organization", async () => {
  await showPage(ContactsOnlyResponder);

  await click(checkbox("Auto-reply to people outside my organization"));
  expect(radio("My Contacts only").checked).toBe(true);
  expect(radio("Anyone outside my organization").disabled).toBe(true);
  expect(target.textContent).toContain("administrator");
  await click(button("Save"));
  expect(server.externalAudience).toBe(AutoResponderAudience.Contacts);
});

/** E.g. EWS, when the admin allows automatic replies only inside the organization */
class InternalOnlyResponder extends TestAutoResponder {
  async load() {
    await super.load();
    this.maxAudience = AutoResponderAudience.None;
  }
}

test("The admin allows no replies outside the organization: no message and no copy buttons for outside", async () => {
  await showPage(InternalOnlyResponder);

  expect(checkbox("Auto-reply to people outside my organization").disabled).toBe(true);
  expect(target.textContent).toContain("administrator");
  expect(target.querySelectorAll(".html-editor").length).toBe(1);
  expect(editorBox().textContent).toContain("Back on Monday");
  expect(copyUpButton()).toBeNull();
  expect(target.textContent).not.toContain("Copy");
});

function copyUpButton(): HTMLButtonElement {
  return target.querySelector("button[title='Copy from Outside My Organization']");
}

test("Copy the message down to outside the organization", async () => {
  await showPage();
  expect(button("Copy").disabled).toBe(true);

  await click(checkbox("Auto-reply to people outside my organization"));
  await click(button("Copy"));
  expect(editorBox(true).textContent).toContain("Back on Monday");
  await click(button("Save"));
  expect(server.externalHTML).toContain("Back on Monday");
});

test("Copy the message up to inside the organization", async () => {
  await showPage();
  expect(copyUpButton().disabled).toBe(false);

  await click(copyUpButton());
  expect(editorBox().textContent).toContain("Away");
  await click(button("Save"));
  expect(server.internalHTML).toContain("Away");
});

test("Leaving the page saves the changes, also without Save", async () => {
  let account = await showPage();
  await account.autoResponder.load();

  await click(radio("Do not send automatic replies"));
  unmount(app);
  await settle();
  expect(server.isOn).toBe(false);
  expect(account.autoResponder.isOn).toBe(false);
});

test("Leaving the page without changes doesn't save", async () => {
  await showPage();
  let save = vi.spyOn(TestAutoResponder.prototype, "save");

  unmount(app);
  await settle();
  expect(save).not.toHaveBeenCalled();
});

/** E.g. JMAP */
class OneMessageResponder extends TestAutoResponder {
  get supportsInternal() {
    return false;
  }
  get supportsContacts() {
    return false;
  }

  async load() {
    await super.load();
    this.externalAudience = AutoResponderAudience.All;
  }
}

test("Without inside and outside the organization, one message for all senders", async () => {
  await showPage(OneMessageResponder);

  expect(target.textContent).toContain("Automatic reply");
  expect(target.textContent).not.toContain("Organization");
  expect(target.querySelectorAll(".html-editor").length).toBe(1);
  expect(editorBox().textContent).toContain("Away");
  expect(editorBox().inert).toBe(false);
  await click(button("Save"));
  expect(server.externalHTML).toContain("Away");
});

test("Missing permission: Allow access, then the settings", async () => {
  await showPage(DeniedResponder);
  expect(target.textContent).toContain("allow access");
  expect(target.querySelector("label.radio")).toBeNull();
  expect(target.textContent).not.toContain("Save");

  await click(button("Allow access"));
  expect(radio("Always send automatic replies").checked).toBe(true);
});
