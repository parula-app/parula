// @vitest-environment happy-dom
// app first, to resolve the import cycle around Addons
import { appGlobal } from "../../../logic/app";
import { AddonProtocol } from "../../../logic/Addons/AddonProtocols";
import type { Account } from "../../../logic/Abstract/Account";
import type { Protocol } from "../../../logic/Addons/Sandbox/MustangAPI";
import ChatSelectProtocol from "../../../frontend/Setup/Chat/SelectProtocol.svelte";
import CalendarSelectProtocol from "../../../frontend/Setup/Calendar/SelectProtocol.svelte";
import ContactsSelectProtocol from "../../../frontend/Setup/Contacts/SelectProtocol.svelte";
import FilesSelectProtocol from "../../../frontend/Setup/Files/SelectProtocol.svelte";
import { FakeProtocolServer, newProtocolAddon, ProtocolSandbox, setUpBackend, waitFor } from "../../logic/Mail/Addon/protocolSandbox";
import type { Collection } from "svelte-collections";
import { flushSync, mount, tick, unmount } from "svelte";
import { afterEach, beforeAll, expect, test, vi } from "vitest";

// The real sandbox needs frames, which happy-dom can't run
vi.mock("../../../logic/Addons/AddonSandbox", async () => ({
  AddonSandbox: (await import("../../logic/Mail/Addon/protocolSandbox")).ProtocolSandbox,
}));

beforeAll(() => {
  (globalThis as any).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  CSSStyleDeclaration.prototype[Symbol.iterator] ??= function* () {
    for (let i = 0; i < this.length; i++) {
      yield this.item(i);
    }
  };
  setUpBackend();
});

let cleanup: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (let undo of cleanup) {
    await undo();
  }
  cleanup = [];
});

const pages: { type: string, page: any, accounts: () => Collection<Account>, operations: object }[] = [
  { type: "chat", page: ChatSelectProtocol, accounts: () => appGlobal.chatAccounts, operations: { listRooms: async () => [] } },
  { type: "calendar", page: CalendarSelectProtocol, accounts: () => appGlobal.calendars, operations: { listEvents: async () => ({ events: [], syncState: "1" }) } },
  { type: "contacts", page: ContactsSelectProtocol, accounts: () => appGlobal.addressbooks, operations: { listContacts: async () => ({ contacts: [], syncState: "1" }) } },
  { type: "files", page: FilesSelectProtocol, accounts: () => appGlobal.fileSharingAccounts, operations: {} },
];

test.each(pages)("The $type setup lists the protocols of running addons, shows the addon's setup UI, and adds the account", async ({ type, page, accounts, operations }) => {
  let server = new FakeProtocolServer();
  let addon = newProtocolAddon("Setup " + type, ["test"], mustang => mustang.protocols.register("test", server.protocol(operations) as Protocol), type);
  await addon.enable();
  let target = document.createElement("div");
  document.body.append(target);
  let app = mount(page, { target, props: { config: null, showPage: page, onCancel: () => {} } });
  cleanup.push(async () => {
    unmount(app);
    target.remove();
    await addon.uninstall();
    (accounts() as any).clear();
  });
  flushSync();
  let choice = [...target.querySelectorAll<HTMLElement>("label.protocol")].find(label => label.textContent.includes(`Setup ${type} test`));
  expect(choice).toBeTruthy();

  choice.querySelector("input").click();
  await tick();
  flushSync();
  let sandbox = addon.sandbox as any as ProtocolSandbox;
  await waitFor(() => sandbox.uiFrames.length == 1);
  let setupUI = sandbox.uiFrames[0];
  expect(setupUI.entry).toBe("dist/setup.js");
  setupUI.client.mustang.protocols.setupAccount({ name: "Work", username: "me", password: "secret" });
  await setupUI.client.roundTrip();
  flushSync();
  [...target.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent.trim() == "Next").click();

  await waitFor(() => accounts().hasItems);
  let account = accounts().first;
  expect(account.protocol).toBe(AddonProtocol.accountProtocol(addon.id, "test"));
  expect(account.name).toBe("Work");
  expect(account.dbID).toBeTruthy();
  expect(server.callsOf("login")[0][1]).toBe("secret");
});

async function mountWithAddonSelected(type: string, page: any, accounts: () => Collection<Account>) {
  let addon = newProtocolAddon("Chosen " + type, ["test"], mustang => mustang.protocols.register("test", new FakeProtocolServer().protocol({}) as Protocol), type);
  let otherAddon = newProtocolAddon("Second " + type, ["test"], mustang => mustang.protocols.register("test", new FakeProtocolServer().protocol({}) as Protocol), type);
  await addon.enable();
  let target = document.createElement("div");
  document.body.append(target);
  let app = mount(page, { target, props: { config: null, showPage: page, onCancel: () => {} } });
  cleanup.push(async () => {
    unmount(app);
    target.remove();
    await addon.uninstall();
    await otherAddon.uninstall();
    (accounts() as any).clear();
  });
  flushSync();
  function radio(label: string): HTMLInputElement | undefined {
    return [...target.querySelectorAll<HTMLElement>("label.protocol")].find(choice => choice.textContent.includes(label))?.querySelector("input");
  }
  function nextButton(): HTMLButtonElement {
    return [...target.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent.trim() == "Next");
  }
  radio(`Chosen ${type} test`).click();
  await tick();
  flushSync();
  let sandbox = addon.sandbox as any as ProtocolSandbox;
  await waitFor(() => sandbox.uiFrames.length == 1);
  return { addon, otherAddon, sandbox, target, radio, nextButton };
}

test.each(pages)("The $type setup keeps the selected addon protocol and its setup UI while other addons start and stop", async ({ type, page, accounts }) => {
  let { otherAddon, sandbox, target, radio, nextButton } = await mountWithAddonSelected(type, page, accounts);
  expect(radio(`Chosen ${type} test`).checked).toBe(true);
  let setupFrame = target.querySelector(".addon-frame");
  expect(setupFrame).toBeTruthy();

  await otherAddon.enable();
  await tick();
  flushSync();
  expect(radio(`Second ${type} test`)).toBeTruthy();
  expect(radio(`Chosen ${type} test`).checked).toBe(true);
  expect(nextButton().disabled).toBe(false);

  await otherAddon.disable();
  await tick();
  flushSync();
  expect(radio(`Second ${type} test`)).toBeFalsy();
  expect(radio(`Chosen ${type} test`).checked).toBe(true);
  expect(nextButton().disabled).toBe(false);
  // The setup UI was not opened again, so what the user entered there stays
  await new Promise(resolve => setTimeout(resolve, 50));
  expect(target.querySelector(".addon-frame")).toBe(setupFrame);
  expect(sandbox.uiFrames.length).toBe(1);
});

test.each(pages)("The $type setup clears the selection when the addon of the selected protocol stops", async ({ type, page, accounts }) => {
  let { addon, otherAddon, target, radio, nextButton } = await mountWithAddonSelected(type, page, accounts);
  await otherAddon.enable();
  await tick();
  flushSync();

  await addon.disable();
  await tick();
  flushSync();
  expect(radio(`Chosen ${type} test`)).toBeFalsy();
  expect([...target.querySelectorAll<HTMLInputElement>("input[type=radio]")].some(input => input.checked)).toBe(false);
  expect(nextButton().disabled).toBe(true);
  expect(target.querySelector(".addon-account-setup")).toBeNull();
});
