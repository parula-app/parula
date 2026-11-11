// @vitest-environment happy-dom
// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../../../logic/app";
import { MailAccount } from "../../../../logic/Mail/MailAccount";
import { AutoResponder, AutoResponderAudience } from "../../../../logic/Mail/AutoResponder";
import AutoResponderPage from "../../../../frontend/Settings/Mail/AutoResponder.svelte";
import { flushSync, mount, tick, unmount } from "svelte";
import { UserError } from "../../../../logic/util/util";
import { afterEach, beforeAll, expect, test, vi } from "vitest";

beforeAll(() => {
  appGlobal.remoteApp = {} as any;
});

/** What the server has */
class TestAutoResponder extends AutoResponder {
  saved = 0;

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
    this.enabled = true;
    this.scheduled = true;
    this.internalHTML = "<p>Back on Monday</p>";
    this.externalAudience = AutoResponderAudience.None;
    this.maxAudience = AutoResponderAudience.Contacts;
  }

  async save() {
    this.saved++;
  }
}

/** Login from before we asked for the permission */
class DeniedResponder extends TestAutoResponder {
  granted = false;

  async load() {
    if (!this.granted) {
      this.needsPermission = true;
      throw new UserError("Please log in once more and allow access.");
    }
    await super.load();
  }

  async grantPermission() {
    this.granted = true;
    this.needsPermission = false;
  }
}

let responderClass: typeof TestAutoResponder;

class TestMailAccount extends MailAccount {
  newAutoResponder() {
    return new responderClass(this);
  }
}

let target: HTMLElement;
let app: any;

afterEach(() => {
  unmount(app);
  target.remove();
});

async function showPage(type = TestAutoResponder): Promise<TestAutoResponder> {
  responderClass = type;
  let account = new TestMailAccount();
  target = document.createElement("div");
  document.body.append(target);
  app = mount(AutoResponderPage, { target, props: { account } });
  await tick(); // `load()`
  flushSync();
  return account.autoResponder as TestAutoResponder;
}

function radio(label: string): HTMLInputElement {
  let found = [...target.querySelectorAll("label.radio")]
    .filter(el => el.textContent.trim() == label);
  expect(found.length, `radio ${label}`).toBe(1);
  return found[0].querySelector("input");
}

/** The `<Checkbox toggle>` */
function toggle(label: string): HTMLElement {
  let found = [...target.querySelectorAll(".checkbox.toggle")]
    .filter(el => el.textContent.trim() == label);
  expect(found.length, `toggle ${label}`).toBe(1);
  return found[0] as HTMLElement;
}

function click(el: HTMLElement) {
  el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  flushSync();
}

test("Shows the settings from the server", async () => {
  await showPage();

  expect(toggle("Send automatic replies").classList.contains("on")).toBe(true);
  expect(target.querySelectorAll("input[type=date]").length).toBe(2);
  expect(target.textContent).toContain("Back on Monday");
  expect(radio("Don't reply").checked).toBe(true);
  expect(radio("Only to my contacts").disabled).toBe(false);
  // The admin allows only contacts
  expect(radio("Anyone outside my organization").disabled).toBe(true);
});

test("Turning it off hides the messages, and saves", async () => {
  let autoResponder = await showPage();

  click(toggle("Send automatic replies"));
  expect(autoResponder.enabled).toBe(false);
  expect(toggle("Send automatic replies").classList.contains("off")).toBe(true);
  expect(target.textContent).not.toContain("Back on Monday");
  expect(target.textContent).not.toContain("Outside my organization");

  click([...target.querySelectorAll("button")].find(el => el.textContent.includes("Save")));
  await tick();
  expect(autoResponder.saved).toBe(1);
});

test("Replying to contacts outside shows their message", async () => {
  let autoResponder = await showPage();

  click(radio("Only to my contacts"));
  expect(autoResponder.externalAudience).toBe(AutoResponderAudience.Contacts);
  expect(target.querySelectorAll(".html-editor").length).toBe(2);
});

test("A login without the permission offers to allow it", async () => {
  let autoResponder = await showPage(DeniedResponder);

  expect(target.textContent).toContain("allow access");
  expect(target.textContent).not.toContain("Send automatic replies");
  click([...target.querySelectorAll("button")].find(el => el.textContent.includes("Allow access")));

  await vi.waitFor(() => {
    flushSync();
    expect(toggle("Send automatic replies").classList.contains("on")).toBe(true);
  });
  expect(autoResponder.needsPermission).toBe(false);
});
