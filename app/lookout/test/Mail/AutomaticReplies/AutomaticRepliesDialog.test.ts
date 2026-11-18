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
    externalAudience: AutoResponderAudience.Internal,
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

function radio(label: string): HTMLInputElement {
  return find("label.radio", label).querySelector("input");
}

function button(label: string): HTMLButtonElement {
  return find("button", label) as HTMLButtonElement;
}

async function click(el: HTMLElement) {
  el.click();
  flushSync();
  await settle();
}

test("Shows the settings from the server, and OK saves them", async () => {
  let { account, onClose } = await show(AutomaticRepliesDialog);
  await account.autoResponder.load();

  expect(radio("Always send automatic replies").checked).toBe(true);
  expect(radio("Only send during this time range:").checked).toBe(false);

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

test("Missing permission: Allow access, then the settings", async () => {
  await show(AutomaticRepliesDialog, DeniedResponder);
  expect(target.textContent).toContain("allow access");
  expect(button("OK").disabled).toBe(true);

  await click(button("Allow access"));
  expect(radio("Always send automatic replies").checked).toBe(true);
  expect(button("OK").disabled).toBe(false);
});

test("The bar shows while automatic replies are being sent, and turns them off", async () => {
  let { account } = await show(AutomaticRepliesBar);
  expect(target.textContent).toContain("Automatic replies are being sent for this account");

  await click(button("Turn off"));
  expect(server.isOn).toBe(false);
  expect(account.autoResponder.isOn).toBe(false);
  expect(target.textContent).not.toContain("Automatic replies are being sent");
});
