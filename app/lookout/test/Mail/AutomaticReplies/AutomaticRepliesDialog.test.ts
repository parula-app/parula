// @vitest-environment happy-dom
// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { MailAccount } from "../../../../logic/Mail/MailAccount";
import { AutoResponder, AutoResponderAudience } from "../../../../logic/Mail/AutoResponder";
import { PermissionMissing } from "../../../../logic/Abstract/Account";
import AutomaticRepliesDialog from "../../../Mail/AutomaticReplies/AutomaticRepliesDialog.svelte";
import AutomaticRepliesBar from "../../../Mail/AutomaticReplies/AutomaticRepliesBar.svelte";
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
  get supportsExternal() {
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
  get isLoggedIn() {
    return true;
  }

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

async function show(component: any, type = TestAutoResponder): Promise<{ account: TestMailAccount, onClose: () => void }> {
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
  let onClose = vi.fn();
  target = document.createElement("div");
  document.body.append(target);
  app = mount(component, { target, props: { account }, events: { close: onClose } });
  await settle();
  return { account, onClose };
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

function input(selector: string, label: string): HTMLInputElement {
  return find(selector, label).querySelector("input");
}

function radio(label: string): HTMLInputElement {
  return input(".lo-radio", label);
}

function checkbox(label: string): HTMLInputElement {
  return input(".lo-checkbox", label);
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
function editor(outside = false): HTMLElement {
  return target.querySelectorAll<HTMLElement>(".ProseMirror")[outside ? 1 : 0];
}

function boldButton(outside = false): HTMLButtonElement {
  return target.querySelectorAll<HTMLButtonElement>("button[aria-label=Bold]")[outside ? 1 : 0];
}

test("Shows the settings from the server, and OK saves them", async () => {
  let { account, onClose } = await show(AutomaticRepliesDialog);
  await account.autoResponder.load();

  expect(radio("Always send automatic replies").checked).toBe(true);
  expect(radio("Only send during this time range:").checked).toBe(false);
  expect(editor().textContent).toContain("Back on Monday");

  await click(radio("Do not send automatic replies"));
  expect(server.isOn).toBe(true);
  await click(button("OK"));
  expect(server.isOn).toBe(false);
  expect(account.autoResponder.isOn).toBe(false);
  expect(onClose).toHaveBeenCalled();
});

test("Cancel keeps the settings on the server and in the account", async () => {
  let { account, onClose } = await show(AutomaticRepliesDialog);
  await account.autoResponder.load();

  await click(radio("Do not send automatic replies"));
  await click(button("Cancel"));
  expect(onClose).toHaveBeenCalled();
  expect(server.isOn).toBe(true);
  expect(account.autoResponder.isOn).toBe(true);
});

test("Only send during this time range, and without automatic replies, the time range and the message are disabled", async () => {
  await show(AutomaticRepliesDialog);
  expect(target.querySelector<HTMLInputElement>(".lo-datefield input").disabled).toBe(true);
  await click(radio("Only send during this time range:"));
  expect(radio("Always send automatic replies").checked).toBe(false);
  expect(target.querySelector<HTMLInputElement>(".lo-datefield input").disabled).toBe(false);
  expect(editor().getAttribute("contenteditable")).toBe("true");
  expect(boldButton().disabled).toBe(false);

  await click(radio("Do not send automatic replies"));
  expect(radio("Only send during this time range:").checked).toBe(false);
  expect(target.querySelector<HTMLInputElement>(".lo-datefield input").disabled).toBe(true);
  expect(editor().getAttribute("contenteditable")).toBe("false");
  expect(boldButton().disabled).toBe(true);

  await click(radio("Only send during this time range:"));
  await click(button("OK"));
  expect(server.isOn).toBe(true);
  expect(server.scheduled).toBe(true);
});

test("Outside the organization: on with the checkbox, with its own message below the one for inside", async () => {
  await show(AutomaticRepliesDialog);

  expect(find(".header", "Inside My Organization")).toBeTruthy();
  expect(find(".header", "Outside My Organization")).toBeTruthy();
  expect(editor().textContent).toContain("Back on Monday");
  expect(editor(true).textContent).toContain("Away");
  expect(editor().getAttribute("contenteditable")).toBe("true");
  expect(editor(true).getAttribute("contenteditable")).toBe("false");
  expect(boldButton(true).disabled).toBe(true);
  expect(radio("Anyone outside my organization").disabled).toBe(true);

  await click(checkbox("Auto-reply to people outside my organization"));
  expect(radio("Anyone outside my organization").checked).toBe(true);
  expect(editor(true).getAttribute("contenteditable")).toBe("true");
  expect(boldButton(true).disabled).toBe(false);
  await click(radio("My Contacts only"));
  await click(button("OK"));
  expect(server.externalAudience).toBe(AutoResponderAudience.Contacts);
});

test("Outside the organization: Copy the message from inside", async () => {
  await show(AutomaticRepliesDialog);
  expect(button("Copy from Inside My Organization").disabled).toBe(true);

  await click(checkbox("Auto-reply to people outside my organization"));
  await click(button("Copy from Inside My Organization"));
  expect(editor(true).textContent).toContain("Back on Monday");
  await click(button("OK"));
  expect(server.externalHTML).toContain("Back on Monday");
});

test("Missing permission: Allow access, then the settings", async () => {
  await show(AutomaticRepliesDialog, DeniedResponder);
  expect(target.textContent).toContain("allow access");
  expect(target.querySelector(".lo-radio")).toBeNull();

  await click(button("Allow access"));
  expect(radio("Always send automatic replies").checked).toBe(true);
});

test("The bar shows while automatic replies are being sent, and turns them off", async () => {
  let { account } = await show(AutomaticRepliesBar);
  expect(target.textContent).toContain("Automatic replies are being sent for this account");

  await click(button("Turn off"));
  expect(server.isOn).toBe(false);
  expect(account.autoResponder.isOn).toBe(false);
  expect(target.textContent).not.toContain("Automatic replies are being sent");
});
