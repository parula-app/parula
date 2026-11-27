// @vitest-environment happy-dom
// app first, to resolve the import cycle around Addons
import "../../../logic/app";
import { Addons } from "../../../logic/Addons/Addons";
import { Addon } from "../../../logic/Addons/Addon";
import { AddonManifest } from "../../../logic/Addons/AddonManifest";
import { AddonSandbox } from "../../../logic/Addons/AddonSandbox";
import type { SandboxFrame } from "../../../logic/Addons/Sandbox/SandboxFrame";
import { sanitizeSVG } from "../../../logic/util/convertHTML";
import { AddonMustangApp, addonMustangApps } from "../../../frontend/Addons/AddonMustangApp";
import { mustangApps, openApp, selectedApp } from "../../../frontend/AppsBar/selectedApp";
import { mailMustangApp } from "../../../frontend/Mail/MailMustangApp";
import { calendarMustangApp } from "../../../frontend/Calendar/CalendarMustangApp";
import { settingsMustangApp } from "../../../frontend/Settings/Window/SettingsMustangApp";
import AppBar from "../../../frontend/AppsBar/AppBar.svelte";
import AppContentRoutes from "../../../frontend/AppsBar/AppContentRoutes.svelte";
import LookoutAppBar from "../../../lookout/AppsBar/AppBar.svelte";
import LookoutAppContentRoutes from "../../../lookout/AppsBar/AppContentRoutes.svelte";
import RoutesHarness from "./RoutesHarness.svelte";
import Notes from "../../../../addons/examples/notes-app/src/Notes.svelte";
import { tick } from "../../logic/Addons/Bridge/fixtures";
import { flushSync, mount, unmount } from "svelte";
import { get } from "svelte/store";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

// happy-dom's DOMPurify can't sanitize SVG (see icon.test.ts), so the sanitizer is replaced, and checked that it's used
const { kSanitizedSVG } = vi.hoisted(() => ({
  kSanitizedSVG: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></svg>`,
}));
vi.mock("../../../logic/util/convertHTML", async importOriginal => ({
  ...await importOriginal<object>(),
  sanitizeSVG: vi.fn(() => kSanitizedSVG),
}));

const kEvilSVG = `<svg xmlns="http://www.w3.org/2000/svg" onload="alert('svg')"><script>alert("script")</script><circle r="10"/></svg>`;

beforeAll(() => {
  (globalThis as any).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  // Chromium has it, happy-dom not
  CSSStyleDeclaration.prototype[Symbol.iterator] ??= function* () {
    for (let i = 0; i < this.length; i++) {
      yield this.item(i);
    }
  };
});

/** UI frames that the app opened, instead of real frames, which happy-dom can't run */
let openedFrames: { container: HTMLElement, entry: string, isRemoved: boolean }[] = [];
let cleanups: (() => void | Promise<void>)[] = [];

beforeEach(() => {
  mustangApps.replaceAll([mailMustangApp, calendarMustangApp, settingsMustangApp]);
  openApp(mailMustangApp, {});
  vi.spyOn(AddonSandbox.prototype, "openUIFrame").mockImplementation(async (container: HTMLElement, entry: string, beforeLoad?: (frame: SandboxFrame) => void) => {
    let opened = { container, entry, isRemoved: false };
    let frame = {
      contentHeight: 0,
      subscribe(run: (value: any) => void) {
        run(frame);
        return () => {};
      },
      setContext() {},
      setTheme() {},
      remove() {
        opened.isRemoved = true;
      },
    } as any as SandboxFrame;
    beforeLoad?.(frame);
    openedFrames.push(opened);
    return frame;
  });
});

afterEach(async () => {
  for (let cleanup of cleanups.splice(0)) {
    await cleanup();
  }
  openedFrames = [];
  vi.restoreAllMocks();
});

function newFiles(files: Record<string, string>): any {
  return {
    async readFile(_version: string, path: string): Promise<Uint8Array> {
      if (!(path in files)) {
        throw new Error(`No file ${path}`);
      }
      return new TextEncoder().encode(files[path]);
    },
    async readStorage(): Promise<string | null> {
      return null;
    },
    async writeStorage(): Promise<void> {},
  };
}

/** A running addon with one app */
async function startAddon(appName = "Notes"): Promise<Addon> {
  let manifest = AddonManifest.fromJSON({
    name: "@test/notes",
    version: "1.0.0",
    mustang: {
      name: "Notes addon",
      icon: "icons/notes.svg",
      apps: [{ id: "notes", name: appName, entry: "dist/app.js" }],
    },
  }, null);
  let addon = new Addon(new Addons(), manifest, newFiles({ "icons/notes.svg": kEvilSVG }));
  addon.grantedPermissions.addAll(manifest.requestedPermissions);
  cleanups.push(() => addon.disable());
  await addon.enable();
  await waitFor(() => appOf(addon) != null);
  return addon;
}

function appOf(addon: Addon): AddonMustangApp | undefined {
  return mustangApps.contents.find(app => app instanceof AddonMustangApp && app.addon == addon) as AddonMustangApp;
}

async function waitFor(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !condition(); i++) {
    await tick(5);
    flushSync();
  }
  if (!condition()) {
    throw new Error("Timeout");
  }
}

function show(component: any, props: any): HTMLElement {
  let target = document.createElement("div");
  document.body.append(target);
  let shown = mount(component, { target, props });
  cleanups.unshift(() => {
    unmount(shown);
    target.remove();
  });
  flushSync();
  return target;
}

describe("Addon apps", () => {
  test("The app of an addon is in the app bar while the addon runs", async () => {
    let addon = await startAddon();
    let app = appOf(addon);
    expect(app.name).toBe("Notes");
    expect(addonMustangApps.contains(app)).toBe(true);
    expect(mustangApps.contents.filter(each => each.id == app.id)).toHaveLength(1);
    expect(mustangApps.contents.filter(each => each.appURL == app.appURL)).toHaveLength(1);
    expect(mustangApps.indexOf(app)).toBeLessThan(mustangApps.indexOf(settingsMustangApp));

    await addon.disable();
    expect(appOf(addon)).toBeUndefined();
    expect(addonMustangApps.contains(app)).toBe(false);
    expect(mustangApps.contents).toEqual([mailMustangApp, calendarMustangApp, settingsMustangApp]);

    await addon.enable();
    await waitFor(() => appOf(addon) != null);
    expect(appOf(addon)).not.toBe(app);
  });

  test("The classic and the Lookout app bar show and remove the app without a restart", async () => {
    for (let bar of [AppBar, LookoutAppBar]) {
      let target = show(bar, { selectedApp: mailMustangApp, showApps: mustangApps });
      let addon = await startAddon();
      flushSync();
      expect(target.textContent).toContain("Notes");
      await addon.disable();
      flushSync();
      expect(target.textContent).not.toContain("Notes");
    }
  });

  test("The icon is the sanitized SVG, as inert image", async () => {
    let addon = await startAddon();
    let app = appOf(addon);
    expect(sanitizeSVG).toHaveBeenCalledWith(kEvilSVG);
    expect(app.icon).toBeInstanceOf(URL);
    expect((app.icon as URL).protocol).toBe("blob:");

    for (let bar of [AppBar, LookoutAppBar]) {
      let target = show(bar, { selectedApp: mailMustangApp, showApps: mustangApps });
      let images = [...target.querySelectorAll("img")];
      expect(images.map(image => image.src)).toEqual([(app.icon as URL).href]);
      expect(target.innerHTML).not.toContain("<script");
      expect(target.innerHTML).not.toContain("alert");
    }
  });

  test("The name shows as plain text", async () => {
    let addon = await startAddon(`<b onmouseover="alert('name')">Notes</b>`);
    for (let bar of [AppBar, LookoutAppBar]) {
      let target = show(bar, { selectedApp: mailMustangApp, showApps: mustangApps });
      expect(target.querySelector("b")).toBeNull();
      expect(target.textContent).toContain(`<b onmouseover="alert('name')">Notes</b>`);
    }
    expect(appOf(addon).name).toBe(`<b onmouseover="alert('name')">Notes</b>`);
  });

  test.each([
    ["classic", AppContentRoutes],
    ["Lookout", LookoutAppContentRoutes],
  ])("Opening the app shows the addon's UI module in a frame that fills the page, in %s", async (_frontend, routes) => {
    let addon = await startAddon();
    let app = appOf(addon);
    let target = show(RoutesHarness, { routes });
    openApp(app, app.windowParams);
    await waitFor(() => openedFrames.length > 0);
    expect(get(selectedApp)).toBe(app);
    expect(openedFrames).toHaveLength(1);
    let [opened] = openedFrames;
    expect(opened.entry).toBe("dist/app.js");
    expect(target.contains(opened.container)).toBe(true);
    expect(opened.container.style.height).toBe("");

    openApp(mailMustangApp, {});
    await waitFor(() => opened.isRemoved);
  });

  test("The open app closes when the addon is disabled, and the window shows Mail", async () => {
    let addon = await startAddon();
    let app = appOf(addon);
    show(RoutesHarness, { routes: AppContentRoutes });
    openApp(app, app.windowParams);
    await waitFor(() => openedFrames.length > 0);

    await addon.disable();
    await waitFor(() => openedFrames[0].isRemoved);
    expect(get(selectedApp)).toBe(mailMustangApp);
    expect(mustangApps.contains(app)).toBe(false);
  });

  test("An app that is not open stays closed when its addon is disabled", async () => {
    let addon = await startAddon();
    openApp(calendarMustangApp, {});
    await addon.disable();
    expect(get(selectedApp)).toBe(calendarMustangApp);
  });
});

describe("Example notes-app", () => {
  /** Stands in for `mustang.storage` in the addon */
  class TestStorage {
    values = new Map<string, any>();
    async get(key: string): Promise<any> {
      return structuredClone(this.values.get(key));
    }
    async set(key: string, value: any): Promise<void> {
      this.values.set(key, structuredClone(value));
    }
    async remove(key: string): Promise<void> {
      this.values.delete(key);
    }
  }

  async function showNotes(storage: TestStorage): Promise<HTMLElement> {
    (globalThis as any).mustang = { storage };
    cleanups.push(() => {
      delete (globalThis as any).mustang;
    });
    let target = show(Notes, {});
    await tick(10);
    flushSync();
    return target;
  }

  function buttonWithText(target: HTMLElement, text: string): HTMLButtonElement | undefined {
    return [...target.querySelectorAll("button")].find(button => button.textContent.trim() == text);
  }

  test("keeps the notes in mustang.storage", async () => {
    let storage = new TestStorage();
    storage.values.set("notes", [{ id: "1", text: "Shopping\nMilk", modified: Date.now() }]);
    let target = await showNotes(storage);
    expect(target.textContent).toContain("Shopping");

    buttonWithText(target, "New note").click();
    await tick(10);
    let textarea = target.querySelector("textarea");
    textarea.value = "Call Alice\nabout the trip";
    textarea.dispatchEvent(new Event("input"));
    window.dispatchEvent(new Event("blur"));
    await tick(10);
    flushSync();
    let saved = storage.values.get("notes");
    expect(saved.map(note => note.text).sort()).toEqual(["Call Alice\nabout the trip", "Shopping\nMilk"]);
    expect(target.textContent).toContain("Call Alice");

    buttonWithText(target, "Delete").click();
    await tick(10);
    expect(storage.values.get("notes").map(note => note.text)).toEqual(["Shopping\nMilk"]);
  });
});
