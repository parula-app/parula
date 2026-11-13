// @vitest-environment happy-dom
// app first, to resolve the import cycle around Abstract/Account.ts
import { appGlobal } from "../../logic/app";
import { MailAccount } from "../../logic/Mail/MailAccount";
import { DummyMailStorage } from "../../logic/Mail/Store/DummyMailStorage";
import { mailMustangApp } from "../../frontend/Mail/MailMustangApp";
import { settingsCategories } from "../../frontend/Settings/SettingsCategory";
import "../../frontend/Settings/SettingsCategories";
import { openSettingsCategoryByID } from "../../frontend/Settings/Window/CategoriesUtils";
import MainWindow from "../../frontend/MainWindow/MainWindow.svelte";
import { SpecialFolder, specialFolderNames } from "../../logic/Mail/Folder";
import { myHarddrive } from "../../logic/Files/Harddrive/HarddriveAccount";
import { getUILocale, gt, saveUILocale, setUILocale } from "../../l10n/l10n";
import { localeNames } from "../../l10n/list";
import { closeSettingsDialog, openOptions } from "../../lookout/Settings/SettingsDialogs";
import { sleep } from "../../logic/util/util";
import { flushSync, mount, unmount } from "svelte";
import { get } from "svelte/store";
import { afterEach, beforeAll, expect, test, vi } from "vitest";

vi.mock("../../logic/startup", () => ({
  getStartObjects: async () => {},
  loginOnStartup: () => {},
}));

beforeAll(() => {
  (globalThis as any).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

let mainWindow: Record<string, any> | null = null;

afterEach(() => {
  mainWindow && unmount(mainWindow);
  mainWindow = null;
  closeSettingsDialog();
  appGlobal.emailAccounts.clear();
  localStorage.clear();
  setUILocale("en");
});

function mountMainWindow(): HTMLElement {
  appGlobal.remoteApp = {
    setTheme: () => {},
    getConfigDir: async () => "/config",
    path: { join: async (...parts: string[]) => parts.join("/") },
    readFile: async () => { throw new Error("ENOENT"); },
  } as any;
  let account = new MailAccount();
  account.name = "Test";
  account.emailAddress = "user@example.com";
  account.storage = new DummyMailStorage();
  appGlobal.emailAccounts.add(account);

  let target = document.createElement("div");
  document.body.append(target);
  mainWindow = mount(MainWindow, { target });
  return target;
}

test("Strings from .ts modules follow the language change", () => {
  setUILocale("en");
  expect(mailMustangApp.name).toBe("Mail");
  expect(specialFolderNames[SpecialFolder.Inbox]).toBe("Inbox");
  let appTitle = get(mailMustangApp.title);

  setUILocale("de");
  expect(gt`Mail`).not.toBe("Mail");
  expect(mailMustangApp.name).toBe(gt`Mail`);
  expect(get(mailMustangApp.title)).not.toBe(appTitle);
  expect(specialFolderNames[SpecialFolder.Inbox]).toBe(gt`Inbox`);
  expect(settingsCategories.find(category => category.id == "mail").name).toBe(gt`Mail`);
  expect(myHarddrive.name).toBe(gt`My computer *=> My local harddrives`);
});

test("Changing the language shows the window in the new language, without restart", async () => {
  setUILocale("en");
  let target = mountMainWindow();
  await sleep(0.1);
  openSettingsCategoryByID("global-appearance");
  await sleep(0.1);
  flushSync();
  expect(target.querySelector(".app-bar").textContent).toContain("Mail");

  // What the language dropdown on the settings page does
  saveUILocale("de");
  setUILocale(getUILocale());
  flushSync();
  expect(gt`Mail`).not.toBe("Mail");
  expect(target.querySelector(".app-bar").textContent).toContain(gt`Mail`);
  expect(target.querySelector(".appearance .language")).toBeTruthy(); // still on the same settings page

  saveUILocale("ar");
  setUILocale(getUILocale());
  flushSync();
  expect(target.querySelector(".main-window").getAttribute("dir")).toBe("rtl");
});

test("Lookout: Changing the language stays on the language page of the settings dialog", async () => {
  setUILocale("en");
  localStorage.setItem("appearance.frontend", JSON.stringify("lookout"));
  let target = mountMainWindow();
  for (let i = 0; i < 300 && !target.querySelector(".lookout-window"); i++) {
    await sleep(0.05);
  }
  openOptions();
  flushSync();
  let languageCategory = [...target.querySelectorAll<HTMLElement>(".settings-category")].find(button => button.textContent.trim() == "Language");
  languageCategory.click();
  flushSync();
  target.querySelector<HTMLElement>(".lo-combobox[aria-label='Display language']").click();
  await sleep(0.05);
  [...document.querySelectorAll<HTMLElement>(".lo-menuitem")].find(item => item.textContent.trim() == localeNames.de).click();
  await sleep(0.1); // `{#await}` of the Lookout window shows it after a microtask

  expect(gt`Mail`).not.toBe("Mail");
  expect(target.querySelector(".nav-rail").textContent).toContain(gt`Mail`);
  expect(target.querySelector(`.lo-combobox[aria-label='${gt`Display language`}']`)).toBeTruthy(); // still on the language page
}, 30000); // the import of the Lookout window takes a while
