// @vitest-environment happy-dom
// app first, to resolve the import cycle around Addons
import { appGlobal } from "../../../logic/app";
import AddonFrame from "../../../frontend/Addons/AddonFrame.svelte";
import { newProtocolAddon, ProtocolSandbox, waitFor } from "../../logic/Mail/Addon/protocolSandbox";
import { flushSync, mount, unmount } from "svelte";
import { afterAll, beforeAll, expect, test, vi } from "vitest";

// The real sandbox needs frames, which happy-dom can't run
vi.mock("../../../logic/Addons/AddonSandbox", async () => ({
  AddonSandbox: (await import("../../logic/Mail/Addon/protocolSandbox")).ProtocolSandbox,
}));

/** happy-dom has no layout, so the test plays the browser and tells the sizes */
const resizeCallbacks: ResizeObserverCallback[] = [];

beforeAll(() => {
  (globalThis as any).ResizeObserver = class {
    constructor(callback: ResizeObserverCallback) {
      resizeCallbacks.push(callback);
    }
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

afterAll(() => {
  Object.defineProperty(window, "devicePixelRatio", { value: 1, configurable: true });
});

// Chromium gives the frame content its rounded width, but shows the frame between its rounded edges.
// At x 340.67 and width 418.66, that's 419px of content in 418px: the right border of full-width inputs was cut off.
// The Electron screenshot of the mail manual setup checks the real layout.
test.each([1, 1.25, 1.5, 2])("At a fractional position and width, the frame is a whole number of device pixels wide (device pixel ratio %s)", async ratio => {
  const kWidth = 418.65625;
  Object.defineProperty(window, "devicePixelRatio", { value: ratio, configurable: true });
  let addon = newProtocolAddon("Frame size " + ratio, ["test"], mustang => mustang.protocols.register("test", {} as any));
  await addon.enable();
  let target = document.createElement("div");
  document.body.append(target);
  let page = mount(AddonFrame, { target, props: { addon, entry: "dist/setup.js" } });
  try {
    await waitFor(() => (addon.sandbox as any as ProtocolSandbox).uiFrames.length == 1);
    let container = target.querySelector<HTMLElement>(".addon-frame");
    for (let callback of resizeCallbacks) {
      callback([{ target: container, contentRect: { x: 0, y: 0, width: kWidth, height: 200 } } as any], null);
    }
    flushSync();

    let width = parseFloat(container.style.getPropertyValue("--frame-width"));
    let devicePixels = width * ratio;
    expect(Math.abs(devicePixels - Math.round(devicePixels))).toBeLessThan(0.001);
    expect(width).toBeLessThanOrEqual(kWidth);
    expect(width).toBeGreaterThan(kWidth - 1);
  } finally {
    unmount(page);
    target.remove();
    await addon.uninstall();
  }
});
