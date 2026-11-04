// @vitest-environment happy-dom
// app first, to resolve the import cycle around Addons
import { appGlobal } from "../../../logic/app";
import { AddonProtocol, addonProtocols } from "../../../logic/Addons/AddonProtocols";
import type { AddonMailAccount } from "../../../logic/Mail/Addon/AddonMailAccount";
import { newAccountForProtocol } from "../../../logic/Mail/AccountsList/MailAccounts";
import AddonAccountSetup from "../../../frontend/Setup/Addon/AddonAccountSetup.svelte";
import { newProtocolAddon, ProtocolSandbox, waitFor } from "../../logic/Mail/Addon/protocolSandbox";
import { flushSync, mount, unmount } from "svelte";
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
  appGlobal.remoteApp = {} as any;
});

let cleanup: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (let undo of cleanup) {
    await undo();
  }
  cleanup = [];
});

test("The setup page shows the addon's setup UI, and the account takes what the user entered there", async () => {
  let addon = newProtocolAddon("Setup Mail", ["test"], mustang => mustang.protocols.register("test", {} as any));
  await addon.enable();
  let protocol = addonProtocols.find(protocol => protocol.addon == addon);
  let account = newAccountForProtocol(protocol.protocol) as AddonMailAccount;
  account.password = "typed on the first page";
  let target = document.createElement("div");
  document.body.append(target);
  let page = mount(AddonAccountSetup, { target, props: { account } });
  cleanup.push(async () => {
    unmount(page);
    await addon.uninstall();
  });
  let sandbox = addon.sandbox as any as ProtocolSandbox;
  await waitFor(() => sandbox.uiFrames.length == 1);
  let setupUI = sandbox.uiFrames[0];
  expect(setupUI.entry).toBe("dist/setup.js");
  flushSync();

  await expect((page as any).onContinue()).rejects.toThrow();

  setupUI.client.mustang.protocols.setupAccount({ name: "Work", username: "me", serverURL: "https://mail.example.com", extra: { region: "eu" } });
  await setupUI.client.roundTrip();
  // A frame that isn't the setup page can't fill out the account
  let { client: otherFrame } = await sandbox.connect();
  otherFrame.mustang.protocols.setupAccount({ name: "Phish", username: "attacker" });
  await otherFrame.roundTrip();

  expect(await (page as any).onContinue()).toBe(true);
  expect(account.name).toBe("Work");
  expect(account.username).toBe("me");
  expect(account.password).toBe("typed on the first page");
  expect(account.url).toBe("https://mail.example.com");
  expect(account.connection.extra).toEqual({ region: "eu" });
});

test("Without its running addon, the setup page says so", async () => {
  let addon = newProtocolAddon("Stopped Mail", ["test"]);
  let account = newAccountForProtocol(AddonProtocol.accountProtocol(addon.id, "test")) as AddonMailAccount;
  let target = document.createElement("div");
  let page = mount(AddonAccountSetup, { target, props: { account } });
  cleanup.push(async () => {
    unmount(page);
    appGlobal.addons.installed.remove(addon);
  });
  flushSync();

  expect(target.textContent).toContain("not running");
  await expect((page as any).onContinue()).rejects.toThrow();
});

test("The setup UI stays while other addons start and stop, and opens again when its addon starts again", async () => {
  let addon = newProtocolAddon("Restarted Mail", ["test"], mustang => mustang.protocols.register("test", {} as any));
  let otherAddon = newProtocolAddon("Second Mail", ["test"], mustang => mustang.protocols.register("test", {} as any));
  await addon.enable();
  let account = newAccountForProtocol(AddonProtocol.accountProtocol(addon.id, "test")) as AddonMailAccount;
  let target = document.createElement("div");
  document.body.append(target);
  let page = mount(AddonAccountSetup, { target, props: { account } });
  cleanup.push(async () => {
    unmount(page);
    target.remove();
    await addon.uninstall();
    await otherAddon.uninstall();
  });
  flushSync();
  let setupFrame = target.querySelector(".addon-frame");
  expect(setupFrame).toBeTruthy();

  await otherAddon.enable();
  await otherAddon.disable();
  flushSync();
  expect(target.querySelector(".addon-frame")).toBe(setupFrame);

  await addon.disable();
  flushSync();
  expect(target.textContent).toContain("not running");
  await addon.enable();
  flushSync();
  let newSandbox = addon.sandbox as any as ProtocolSandbox;
  await waitFor(() => newSandbox.uiFrames.length == 1);
  expect(target.querySelector(".addon-frame")).not.toBe(setupFrame);
});
